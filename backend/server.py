from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, UploadFile, File
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta, date
import jwt
from passlib.context import CryptContext
from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContent
import base64
import json
from youtube_transcript_api import YouTubeTranscriptApi
import re

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# JWT Configuration
SECRET_KEY = os.environ.get('SECRET_KEY', 'your-secret-key-change-in-production')
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Security
security = HTTPBearer()

# Gemini API Key (user provided)
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY')

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# ============== MODELS ==============

class User(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    username: str
    email: EmailStr
    password_hash: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    theme: str = "light"  # light or dark
    preferences: dict = Field(default_factory=dict)

class UserSignup(BaseModel):
    username: str
    email: EmailStr
    password: str

class UserLogin(BaseModel):
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    id: str
    username: str
    email: str
    theme: str
    created_at: datetime

class Token(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse

# ============== HELPER FUNCTIONS ==============

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        token = credentials.credentials
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid authentication credentials")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    
    user = await db.users.find_one({"id": user_id}, {"_id": 0})
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    
    return user

# ============== AUTH ROUTES ==============

@api_router.post("/auth/signup", response_model=Token)
async def signup(user_data: UserSignup):
    # Check if user already exists
    existing_user = await db.users.find_one({"email": user_data.email}, {"_id": 0})
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
    
    existing_username = await db.users.find_one({"username": user_data.username}, {"_id": 0})
    if existing_username:
        raise HTTPException(status_code=400, detail="Username already taken")
    
    # Create new user
    user = User(
        username=user_data.username,
        email=user_data.email,
        password_hash=hash_password(user_data.password)
    )
    
    user_dict = user.model_dump()
    user_dict['created_at'] = user_dict['created_at'].isoformat()
    
    await db.users.insert_one(user_dict)
    
    # Create access token
    access_token = create_access_token(data={"sub": user.id})
    
    user_response = UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        theme=user.theme,
        created_at=user.created_at
    )
    
    return Token(access_token=access_token, token_type="bearer", user=user_response)

@api_router.post("/auth/login", response_model=Token)
async def login(user_data: UserLogin):
    # Find user by email
    user = await db.users.find_one({"email": user_data.email}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    # Verify password
    if not verify_password(user_data.password, user['password_hash']):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    
    # Create access token
    access_token = create_access_token(data={"sub": user['id']})
    
    user_response = UserResponse(
        id=user['id'],
        username=user['username'],
        email=user['email'],
        theme=user.get('theme', 'light'),
        created_at=datetime.fromisoformat(user['created_at']) if isinstance(user['created_at'], str) else user['created_at']
    )
    
    return Token(access_token=access_token, token_type="bearer", user=user_response)

@api_router.get("/auth/me", response_model=UserResponse)
async def get_me(current_user: dict = Depends(get_current_user)):
    return UserResponse(
        id=current_user['id'],
        username=current_user['username'],
        email=current_user['email'],
        theme=current_user.get('theme', 'light'),
        created_at=datetime.fromisoformat(current_user['created_at']) if isinstance(current_user['created_at'], str) else current_user['created_at']
    )

# ============== CHAT MODELS ==============

class ChatMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    role: str  # "user" or "assistant"
    content: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class ChatMessageCreate(BaseModel):
    message: str

class ChatMessageResponse(BaseModel):
    id: str
    role: str
    content: str
    created_at: datetime

class ChatResponse(BaseModel):
    user_message: ChatMessageResponse
    assistant_message: ChatMessageResponse

# ============== CHAT ROUTES ==============

@api_router.post("/chat/message", response_model=ChatResponse)
async def send_chat_message(input: ChatMessageCreate, current_user: dict = Depends(get_current_user)):
    try:
        # Create user message
        user_message_obj = ChatMessage(
            user_id=current_user['id'],
            role="user",
            content=input.message
        )
        
        # Save user message to database
        user_msg_dict = user_message_obj.model_dump()
        user_msg_dict['created_at'] = user_msg_dict['created_at'].isoformat()
        await db.chat_messages.insert_one(user_msg_dict)
        
        # Initialize LLM Chat
        chat = LlmChat(
            api_key=GEMINI_API_KEY,
            session_id=current_user['id'],
            system_message=f"""You are AI Guardian, a friendly and helpful AI assistant for nutrition, meal planning, and health tracking. 
You help users with:
- Meal suggestions and recipes
- Nutrition advice
- Meal logging
- Workout tracking
- Water intake tracking
- General health and wellness questions

User's name: {current_user['username']}

Be concise, friendly, and actionable in your responses."""
        ).with_model("gemini", "gemini-2.5-flash")
        
        # Send message to Gemini
        user_message = UserMessage(text=input.message)
        response = await chat.send_message(user_message)
        
        assistant_content = response
        
        # Create assistant message
        assistant_message_obj = ChatMessage(
            user_id=current_user['id'],
            role="assistant",
            content=assistant_content
        )
        
        # Save assistant message to database
        assistant_msg_dict = assistant_message_obj.model_dump()
        assistant_msg_dict['created_at'] = assistant_msg_dict['created_at'].isoformat()
        await db.chat_messages.insert_one(assistant_msg_dict)
        
        return ChatResponse(
            user_message=ChatMessageResponse(
                id=user_message_obj.id,
                role=user_message_obj.role,
                content=user_message_obj.content,
                created_at=user_message_obj.created_at
            ),
            assistant_message=ChatMessageResponse(
                id=assistant_message_obj.id,
                role=assistant_message_obj.role,
                content=assistant_message_obj.content,
                created_at=assistant_message_obj.created_at
            )
        )
        
    except Exception as e:
        logger.error(f"Chat error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate response: {str(e)}")

@api_router.get("/chat/history", response_model=List[ChatMessageResponse])
async def get_chat_history(current_user: dict = Depends(get_current_user), limit: int = 50):
    messages = await db.chat_messages.find(
        {"user_id": current_user['id']},
        {"_id": 0}
    ).sort("created_at", -1).limit(limit).to_list(limit)
    
    messages.reverse()  # Oldest first
    
    return [
        ChatMessageResponse(
            id=msg['id'],
            role=msg['role'],
            content=msg['content'],
            created_at=datetime.fromisoformat(msg['created_at']) if isinstance(msg['created_at'], str) else msg['created_at']
        )
        for msg in messages
    ]

@api_router.delete("/chat/history")
async def clear_chat_history(current_user: dict = Depends(get_current_user)):
    result = await db.chat_messages.delete_many({"user_id": current_user['id']})
    return {"deleted_count": result.deleted_count, "message": "Chat history cleared"}

# ============== MEAL MODELS ==============

class Meal(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    food_name: str
    calories: float
    protein: float
    carbs: float
    fat: float
    serving_size: str
    source: str  # "manual" or "photo"
    confidence: Optional[float] = None
    logged_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class MealCreate(BaseModel):
    food_name: str
    calories: float
    protein: float
    carbs: float
    fat: float
    serving_size: str
    source: str = "manual"

class MealResponse(BaseModel):
    id: str
    food_name: str
    calories: float
    protein: float
    carbs: float
    fat: float
    serving_size: str
    source: str
    confidence: Optional[float]
    logged_at: datetime

class PhotoRecognitionResult(BaseModel):
    food_name: str
    calories: float
    protein: float
    carbs: float
    fat: float
    serving_size: str
    confidence: float

class DailyStats(BaseModel):
    date: str
    total_calories: float
    total_protein: float
    total_carbs: float
    total_fat: float
    meal_count: int

# ============== MEAL ROUTES ==============

@api_router.post("/meals", response_model=MealResponse)
async def create_meal(input: MealCreate, current_user: dict = Depends(get_current_user)):
    meal = Meal(
        user_id=current_user['id'],
        **input.model_dump()
    )
    
    meal_dict = meal.model_dump()
    meal_dict['logged_at'] = meal_dict['logged_at'].isoformat()
    
    await db.meals.insert_one(meal_dict)
    
    return MealResponse(**meal.model_dump())

@api_router.get("/meals", response_model=List[MealResponse])
async def get_meals(
    current_user: dict = Depends(get_current_user),
    date_filter: Optional[str] = None,
    limit: int = 50
):
    query = {"user_id": current_user['id']}
    
    if date_filter:
        # Filter by specific date (YYYY-MM-DD format)
        try:
            filter_date = datetime.fromisoformat(date_filter).date()
            start_of_day = datetime.combine(filter_date, datetime.min.time(), tzinfo=timezone.utc)
            end_of_day = datetime.combine(filter_date, datetime.max.time(), tzinfo=timezone.utc)
            query['logged_at'] = {
                '$gte': start_of_day.isoformat(),
                '$lte': end_of_day.isoformat()
            }
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD")
    
    meals = await db.meals.find(query, {"_id": 0}).sort("logged_at", -1).limit(limit).to_list(limit)
    
    return [
        MealResponse(
            id=meal['id'],
            food_name=meal['food_name'],
            calories=meal['calories'],
            protein=meal['protein'],
            carbs=meal['carbs'],
            fat=meal['fat'],
            serving_size=meal['serving_size'],
            source=meal['source'],
            confidence=meal.get('confidence'),
            logged_at=datetime.fromisoformat(meal['logged_at']) if isinstance(meal['logged_at'], str) else meal['logged_at']
        )
        for meal in meals
    ]

@api_router.delete("/meals/{meal_id}")
async def delete_meal(meal_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.meals.delete_one({"id": meal_id, "user_id": current_user['id']})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Meal not found")
    return {"message": "Meal deleted"}

@api_router.get("/meals/stats/today", response_model=DailyStats)
async def get_today_stats(current_user: dict = Depends(get_current_user)):
    today = date.today()
    start_of_day = datetime.combine(today, datetime.min.time(), tzinfo=timezone.utc)
    end_of_day = datetime.combine(today, datetime.max.time(), tzinfo=timezone.utc)
    
    meals = await db.meals.find({
        "user_id": current_user['id'],
        "logged_at": {
            "$gte": start_of_day.isoformat(),
            "$lte": end_of_day.isoformat()
        }
    }, {"_id": 0}).to_list(1000)
    
    total_calories = sum(meal['calories'] for meal in meals)
    total_protein = sum(meal['protein'] for meal in meals)
    total_carbs = sum(meal['carbs'] for meal in meals)
    total_fat = sum(meal['fat'] for meal in meals)
    
    return DailyStats(
        date=today.isoformat(),
        total_calories=total_calories,
        total_protein=total_protein,
        total_carbs=total_carbs,
        total_fat=total_fat,
        meal_count=len(meals)
    )

@api_router.post("/meals/recognize", response_model=PhotoRecognitionResult)
async def recognize_food(file: UploadFile = File(...), current_user: dict = Depends(get_current_user)):
    try:
        # Read image file
        contents = await file.read()
        
        # Convert to base64
        image_base64 = base64.b64encode(contents).decode('utf-8')
        
        # Get content type
        content_type = file.content_type or 'image/jpeg'
        
        # Create Gemini chat with vision
        chat = LlmChat(
            api_key=GEMINI_API_KEY,
            session_id=f"food_recognition_{current_user['id']}_{uuid.uuid4()}",
            system_message="You are a nutrition expert AI that identifies food from images."
        ).with_model("gemini", "gemini-2.5-flash")
        
        # Create message with image
        file_content = FileContent(
            content_type=content_type,
            file_content_base64=image_base64
        )
        
        prompt = """Identify this food and estimate its nutritional content per serving.

Return ONLY a JSON object with these exact fields (no additional text):
{
    "food_name": "name of the food",
    "calories": calories per serving (number),
    "protein": protein in grams (number),
    "carbs": carbohydrates in grams (number),
    "fat": fat in grams (number),
    "serving_size": "serving size description",
    "confidence": confidence level 0.0-1.0 (number)
}

Be specific about the food name. For serving size, describe what you see (e.g., "1 plate", "2 slices", "1 bowl")."""
        
        user_message = UserMessage(
            text=prompt,
            file_contents=[file_content]
        )
        
        # Get response from Gemini
        response = await chat.send_message(user_message)
        
        # Parse JSON response
        # Remove markdown code blocks if present
        response_text = response.strip()
        if response_text.startswith('```json'):
            response_text = response_text[7:]
        if response_text.startswith('```'):
            response_text = response_text[3:]
        if response_text.endswith('```'):
            response_text = response_text[:-3]
        response_text = response_text.strip()
        
        result = json.loads(response_text)
        
        return PhotoRecognitionResult(**result)
        
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse Gemini response: {response}")
        raise HTTPException(status_code=500, detail="Failed to parse AI response")
    except Exception as e:
        logger.error(f"Food recognition error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to recognize food: {str(e)}")

# ============== RECIPE MODELS ==============

class Ingredient(BaseModel):
    item: str
    quantity: str

class Recipe(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: Optional[str] = None  # None for public recipes
    title: str
    description: Optional[str] = None
    ingredients: List[Ingredient]
    instructions: List[str]
    prep_time: Optional[int] = None  # minutes
    cook_time: Optional[int] = None  # minutes
    servings: Optional[int] = None
    calories: Optional[float] = None
    protein: Optional[float] = None
    carbs: Optional[float] = None
    fat: Optional[float] = None
    dietary_tags: List[str] = Field(default_factory=list)
    source_type: str = "manual"  # manual, youtube
    source_url: Optional[str] = None
    video_id: Optional[str] = None
    channel_name: Optional[str] = None
    thumbnail_url: Optional[str] = None
    image_url: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    saved_by: List[str] = Field(default_factory=list)  # List of user IDs who saved this

class RecipeCreate(BaseModel):
    title: str
    description: Optional[str] = None
    ingredients: List[Ingredient]
    instructions: List[str]
    prep_time: Optional[int] = None
    cook_time: Optional[int] = None
    servings: Optional[int] = None
    calories: Optional[float] = None
    protein: Optional[float] = None
    carbs: Optional[float] = None
    fat: Optional[float] = None
    dietary_tags: List[str] = Field(default_factory=list)
    image_url: Optional[str] = None

class RecipeResponse(BaseModel):
    id: str
    title: str
    description: Optional[str]
    ingredients: List[Ingredient]
    instructions: List[str]
    prep_time: Optional[int]
    cook_time: Optional[int]
    servings: Optional[int]
    calories: Optional[float]
    protein: Optional[float]
    carbs: Optional[float]
    fat: Optional[float]
    dietary_tags: List[str]
    source_type: str
    source_url: Optional[str]
    video_id: Optional[str]
    channel_name: Optional[str]
    thumbnail_url: Optional[str]
    image_url: Optional[str]
    created_at: datetime
    is_saved: bool = False

class YouTubeRecipeRequest(BaseModel):
    youtube_url: str

# ============== RECIPE ROUTES ==============

def extract_video_id(url: str) -> str:
    """Extract video ID from YouTube URL"""
    patterns = [
        r'(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\n?#]+)',
        r'youtube\.com\/embed\/([^&\n?#]+)',
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    raise ValueError("Invalid YouTube URL")

@api_router.post("/recipes", response_model=RecipeResponse)
async def create_recipe(input: RecipeCreate, current_user: dict = Depends(get_current_user)):
    recipe = Recipe(
        user_id=current_user['id'],
        **input.model_dump()
    )
    
    recipe_dict = recipe.model_dump()
    recipe_dict['created_at'] = recipe_dict['created_at'].isoformat()
    
    await db.recipes.insert_one(recipe_dict)
    
    response = RecipeResponse(**recipe.model_dump())
    response.is_saved = current_user['id'] in recipe.saved_by
    return response

@api_router.get("/recipes", response_model=List[RecipeResponse])
async def get_recipes(
    current_user: dict = Depends(get_current_user),
    saved_only: bool = False,
    limit: int = 50
):
    query = {}
    
    if saved_only:
        query['saved_by'] = current_user['id']
    
    recipes = await db.recipes.find(query, {"_id": 0}).sort("created_at", -1).limit(limit).to_list(limit)
    
    return [
        RecipeResponse(
            **{k: v for k, v in recipe.items() if k != 'saved_by'},
            is_saved=current_user['id'] in recipe.get('saved_by', []),
            created_at=datetime.fromisoformat(recipe['created_at']) if isinstance(recipe['created_at'], str) else recipe['created_at']
        )
        for recipe in recipes
    ]

@api_router.get("/recipes/{recipe_id}", response_model=RecipeResponse)
async def get_recipe(recipe_id: str, current_user: dict = Depends(get_current_user)):
    recipe = await db.recipes.find_one({"id": recipe_id}, {"_id": 0})
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    
    return RecipeResponse(
        **{k: v for k, v in recipe.items() if k != 'saved_by'},
        is_saved=current_user['id'] in recipe.get('saved_by', []),
        created_at=datetime.fromisoformat(recipe['created_at']) if isinstance(recipe['created_at'], str) else recipe['created_at']
    )

@api_router.post("/recipes/{recipe_id}/save")
async def save_recipe(recipe_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.recipes.update_one(
        {"id": recipe_id},
        {"$addToSet": {"saved_by": current_user['id']}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return {"message": "Recipe saved"}

@api_router.post("/recipes/{recipe_id}/unsave")
async def unsave_recipe(recipe_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.recipes.update_one(
        {"id": recipe_id},
        {"$pull": {"saved_by": current_user['id']}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return {"message": "Recipe unsaved"}

@api_router.delete("/recipes/{recipe_id}")
async def delete_recipe(recipe_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.recipes.delete_one({"id": recipe_id, "user_id": current_user['id']})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Recipe not found or unauthorized")
    return {"message": "Recipe deleted"}

@api_router.post("/recipes/youtube", response_model=RecipeResponse)
async def extract_youtube_recipe(input: YouTubeRecipeRequest, current_user: dict = Depends(get_current_user)):
    try:
        # Extract video ID
        video_id = extract_video_id(input.youtube_url)
        
        # Fetch transcript
        transcript_list = YouTubeTranscriptApi.get_transcript(video_id)
        transcript_text = " ".join([entry['text'] for entry in transcript_list])
        
        # Get video metadata (thumbnail)
        thumbnail_url = f"https://img.youtube.com/vi/{video_id}/maxresdefault.jpg"
        
        # Use Gemini to extract recipe
        chat = LlmChat(
            api_key=GEMINI_API_KEY,
            session_id=f"youtube_recipe_{video_id}",
            system_message="You are a recipe extraction expert."
        ).with_model("gemini", "gemini-2.5-flash")
        
        prompt = f"""Extract the recipe from this cooking video transcript.

Transcript:
{transcript_text[:8000]}

Return ONLY a JSON object with these exact fields:
{{
    "title": "recipe title",
    "description": "brief description",
    "ingredients": [
        {{"item": "ingredient name", "quantity": "amount"}}
    ],
    "instructions": ["step 1", "step 2", ...],
    "prep_time": prep time in minutes (number or null),
    "cook_time": cook time in minutes (number or null),
    "servings": number of servings (number or null),
    "calories": calories per serving (number or null),
    "protein": protein in grams (number or null),
    "carbs": carbs in grams (number or null),
    "fat": fat in grams (number or null),
    "dietary_tags": ["tag1", "tag2"],
    "channel_name": "channel name if mentioned or null"
}}

If nutritional info is not mentioned, use null. Be specific and detailed."""
        
        user_message = UserMessage(text=prompt)
        response = await chat.send_message(user_message)
        
        # Parse response
        response_text = response.strip()
        if response_text.startswith('```json'):
            response_text = response_text[7:]
        if response_text.startswith('```'):
            response_text = response_text[3:]
        if response_text.endswith('```'):
            response_text = response_text[:-3]
        response_text = response_text.strip()
        
        recipe_data = json.loads(response_text)
        
        # Create recipe
        recipe = Recipe(
            user_id=current_user['id'],
            title=recipe_data['title'],
            description=recipe_data.get('description'),
            ingredients=[Ingredient(**ing) for ing in recipe_data['ingredients']],
            instructions=recipe_data['instructions'],
            prep_time=recipe_data.get('prep_time'),
            cook_time=recipe_data.get('cook_time'),
            servings=recipe_data.get('servings'),
            calories=recipe_data.get('calories'),
            protein=recipe_data.get('protein'),
            carbs=recipe_data.get('carbs'),
            fat=recipe_data.get('fat'),
            dietary_tags=recipe_data.get('dietary_tags', []),
            source_type="youtube",
            source_url=input.youtube_url,
            video_id=video_id,
            channel_name=recipe_data.get('channel_name'),
            thumbnail_url=thumbnail_url
        )
        
        recipe_dict = recipe.model_dump()
        recipe_dict['created_at'] = recipe_dict['created_at'].isoformat()
        
        await db.recipes.insert_one(recipe_dict)
        
        response = RecipeResponse(**recipe.model_dump())
        response.is_saved = current_user['id'] in recipe.saved_by
        return response
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"YouTube recipe extraction error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to extract recipe: {str(e)}")

# ============== BASIC ROUTES ==============

@api_router.get("/")
async def root():
    return {"message": "AI Guardian API"}

@api_router.get("/health")
async def health_check():
    return {"status": "healthy"}

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
