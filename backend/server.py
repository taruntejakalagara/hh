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
from emergentintegrations.llm.chat import LlmChat, UserMessage, FileContent, ImageContent
import base64
import json
from youtube_transcript_api import YouTubeTranscriptApi
import re
import googlemaps

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

# Emergent LLM Key for image generation
EMERGENT_LLM_KEY = os.environ.get('EMERGENT_LLM_KEY')

# Google Places API Key
GOOGLE_PLACES_API_KEY = os.environ.get('GOOGLE_PLACES_API_KEY')
gmaps = googlemaps.Client(key=GOOGLE_PLACES_API_KEY) if GOOGLE_PLACES_API_KEY else None

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

class RecipeMorphRequest(BaseModel):
    recipe_id: str
    target_cuisine: str

class RecipeMorphResponse(BaseModel):
    original_recipe: RecipeResponse
    morphed_recipe: RecipeResponse
    changes_explanation: str

@api_router.post("/recipes/morph", response_model=RecipeMorphResponse)
async def morph_recipe(input: RecipeMorphRequest, current_user: dict = Depends(get_current_user)):
    try:
        # Get original recipe
        original_recipe = await db.recipes.find_one({"id": input.recipe_id}, {"_id": 0})
        if not original_recipe:
            raise HTTPException(status_code=404, detail="Recipe not found")
        
        # Prepare original recipe data
        ingredients_text = "\n".join([f"- {ing['quantity']} {ing['item']}" for ing in original_recipe['ingredients']])
        instructions_text = "\n".join([f"{i+1}. {inst}" for i, inst in enumerate(original_recipe['instructions'])])
        
        # Use Gemini to morph recipe
        chat = LlmChat(
            api_key=GEMINI_API_KEY,
            session_id=f"recipe_morph_{input.recipe_id}_{input.target_cuisine}",
            system_message="You are a culinary expert specializing in adapting recipes across different cuisines."
        ).with_model("gemini", "gemini-2.5-flash")
        
        original_cuisine = original_recipe.get('dietary_tags', ['Unknown'])[0] if original_recipe.get('dietary_tags') else 'Unknown'
        
        prompt = f"""Transform this {original_cuisine} recipe into {input.target_cuisine} style.

ORIGINAL RECIPE:
Title: {original_recipe['title']}
Description: {original_recipe.get('description', 'N/A')}

Ingredients:
{ingredients_text}

Instructions:
{instructions_text}

Prep Time: {original_recipe.get('prep_time', 'N/A')} minutes
Cook Time: {original_recipe.get('cook_time', 'N/A')} minutes
Servings: {original_recipe.get('servings', 'N/A')}

REQUIREMENTS:
1. Keep the cooking method similar (e.g., if it's baked, keep it baked)
2. Maintain similar nutritional profile (calories, protein, carbs, fat)
3. Replace ingredients with culturally appropriate {input.target_cuisine} alternatives
4. Adapt spices, seasonings, and flavors to match {input.target_cuisine} cuisine
5. Keep prep and cook times roughly the same

Return ONLY a JSON object with these exact fields:
{{
    "title": "new {input.target_cuisine}-style recipe title",
    "description": "brief description of the morphed recipe",
    "ingredients": [
        {{"item": "ingredient name", "quantity": "amount"}}
    ],
    "instructions": ["step 1", "step 2", ...],
    "prep_time": prep time in minutes (number),
    "cook_time": cook time in minutes (number),
    "servings": number of servings (number),
    "calories": estimated calories (number, similar to original),
    "protein": protein in grams (number, similar to original),
    "carbs": carbs in grams (number, similar to original),
    "fat": fat in grams (number, similar to original),
    "dietary_tags": ["{input.target_cuisine}", ...other tags],
    "changes_explanation": "Detailed explanation of what changed and why. Highlight key ingredient substitutions and flavor adaptations."
}}"""
        
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
        
        morphed_data = json.loads(response_text)
        changes_explanation = morphed_data.pop('changes_explanation')
        
        # Create morphed recipe
        morphed_recipe = Recipe(
            user_id=current_user['id'],
            title=morphed_data['title'],
            description=morphed_data.get('description'),
            ingredients=[Ingredient(**ing) for ing in morphed_data['ingredients']],
            instructions=morphed_data['instructions'],
            prep_time=morphed_data.get('prep_time'),
            cook_time=morphed_data.get('cook_time'),
            servings=morphed_data.get('servings'),
            calories=morphed_data.get('calories'),
            protein=morphed_data.get('protein'),
            carbs=morphed_data.get('carbs'),
            fat=morphed_data.get('fat'),
            dietary_tags=morphed_data.get('dietary_tags', [input.target_cuisine]),
            source_type="morphed",
            source_url=f"morphed_from_{input.recipe_id}"
        )
        
        # Don't save to DB yet - just return for preview
        original_response = RecipeResponse(
            **{k: v for k, v in original_recipe.items() if k != 'saved_by'},
            is_saved=current_user['id'] in original_recipe.get('saved_by', []),
            created_at=datetime.fromisoformat(original_recipe['created_at']) if isinstance(original_recipe['created_at'], str) else original_recipe['created_at']
        )
        
        morphed_response = RecipeResponse(**morphed_recipe.model_dump(), is_saved=False)
        
        return RecipeMorphResponse(
            original_recipe=original_response,
            morphed_recipe=morphed_response,
            changes_explanation=changes_explanation
        )
        
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse morph response: {response}")
        raise HTTPException(status_code=500, detail="Failed to parse AI response")
    except Exception as e:
        logger.error(f"Recipe morph error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to morph recipe: {str(e)}")

@api_router.get("/recipes/{recipe_id}/generate-image")
async def generate_recipe_image(recipe_id: str, current_user: dict = Depends(get_current_user)):
    try:
        # Get recipe
        recipe = await db.recipes.find_one({"id": recipe_id}, {"_id": 0})
        if not recipe:
            raise HTTPException(status_code=404, detail="Recipe not found")
        
        # Check if image already generated
        if recipe.get('image_url'):
            return {"image_url": recipe['image_url'], "cached": True}
        
        # Generate image using Gemini Nano Banana
        chat = LlmChat(
            api_key=EMERGENT_LLM_KEY,
            session_id=f"recipe_image_{recipe_id}",
            system_message="You are a food photography AI"
        ).with_model("gemini", "gemini-3-pro-image-preview").with_params(modalities=["image", "text"])
        
        # Create detailed prompt
        prompt = f"""Create a beautiful food photography image of: {recipe['title']}

Style: Professional overhead shot, clean white plate, natural lighting, appetizing presentation, restaurant quality.
Focus on making the food look delicious and inviting.
Composition: centered, good contrast, vibrant colors."""
        
        user_message = UserMessage(text=prompt)
        
        # Generate image
        text_response, images = await chat.send_message_multimodal_response(user_message)
        
        if not images or len(images) == 0:
            raise HTTPException(status_code=500, detail="No image generated")
        
        # Get first image
        image_data = images[0]
        image_base64 = image_data['data']
        mime_type = image_data['mime_type']
        
        # Create data URL
        image_url = f"data:{mime_type};base64,{image_base64}"
        
        # Cache in database (store just first 100 chars for logging)
        logger.info(f"Generated image for recipe {recipe_id}, data starts with: {image_url[:50]}...")
        
        await db.recipes.update_one(
            {"id": recipe_id},
            {"$set": {"image_url": image_url}}
        )
        
        return {"image_url": image_url, "cached": False}
        
    except Exception as e:
        logger.error(f"Image generation error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate image: {str(e)}")

# ============== USER SETTINGS ==============

class ThemeUpdate(BaseModel):
    theme: str  # "light" or "dark"

@api_router.put("/users/theme")
async def update_theme(input: ThemeUpdate, current_user: dict = Depends(get_current_user)):
    if input.theme not in ["light", "dark"]:
        raise HTTPException(status_code=400, detail="Invalid theme. Must be 'light' or 'dark'")
    
    await db.users.update_one(
        {"id": current_user['id']},
        {"$set": {"theme": input.theme}}
    )
    
    return {"message": "Theme updated", "theme": input.theme}

class DeliveryPartnerUpdate(BaseModel):
    delivery_partner: str  # "instacart", "doordash", "ubereats", "amazon_fresh"

@api_router.put("/users/delivery-partner")
async def update_delivery_partner(input: DeliveryPartnerUpdate, current_user: dict = Depends(get_current_user)):
    valid_partners = ["instacart", "doordash", "ubereats", "amazon_fresh"]
    if input.delivery_partner not in valid_partners:
        raise HTTPException(status_code=400, detail=f"Invalid delivery partner. Must be one of: {', '.join(valid_partners)}")
    
    await db.users.update_one(
        {"id": current_user['id']},
        {"$set": {"delivery_partner": input.delivery_partner}}
    )
    
    return {"message": "Delivery partner updated", "delivery_partner": input.delivery_partner}

@api_router.get("/users/me/full")
async def get_user_full(current_user: dict = Depends(get_current_user)):
    """Get user with all preferences"""
    return {
        "id": current_user['id'],
        "username": current_user['username'],
        "email": current_user['email'],
        "theme": current_user.get('theme', 'light'),
        "delivery_partner": current_user.get('delivery_partner', 'instacart')
    }

# ============== STORE INVENTORY MAPPING ==============

STORE_INVENTORIES = {
    "gas_station": [
        "jerky", "tuna", "eggs", "coffee", "protein bars", "trail mix", 
        "chips", "candy", "water", "bananas", "nuts", "snacks"
    ],
    "convenience_store": [
        "sandwiches", "salads", "yogurt", "fruit", "energy drinks", "milk", 
        "cheese", "hummus", "crackers", "nuts", "bread", "butter", "eggs"
    ],
    "pharmacy": [
        "protein bars", "nuts", "dried fruit", "canned soup", "crackers", 
        "peanut butter", "granola", "water", "vitamins", "snacks"
    ],
    "supermarket": "*",  # All ingredients available
    "food": [  # Dollar stores
        "canned beans", "rice", "pasta", "canned tuna", "peanut butter", 
        "bread", "ramen", "canned vegetables", "oatmeal", "hot sauce", 
        "eggs", "milk", "cheese", "butter"
    ]
}

def recipe_matches_store_inventory(recipe: dict, store_type: str) -> bool:
    """Check if recipe ingredients are available at store type"""
    if store_type == "supermarket":
        return True  # Everything available at supermarket
    
    inventory = STORE_INVENTORIES.get(store_type, [])
    if not inventory:
        return False
    
    # Check if most ingredients are available (allow 20% missing)
    ingredients = recipe.get('ingredients', [])
    if not ingredients:
        return True
    
    matched = 0
    for ing in ingredients:
        item = ing.get('item', '').lower()
        # Check if any inventory item is in the ingredient
        if any(inv_item.lower() in item or item in inv_item.lower() for inv_item in inventory):
            matched += 1
    
    # Allow recipe if at least 80% of ingredients are available
    match_ratio = matched / len(ingredients)
    return match_ratio >= 0.8

# ============== STORE MODELS ==============

class NearbyStoresRequest(BaseModel):
    lat: float
    lng: float

class StoreInfo(BaseModel):
    place_id: str
    name: str
    address: str
    lat: float
    lng: float
    distance: float  # meters
    store_type: str
    open_now: Optional[bool] = None

# ============== STORE ROUTES ==============

@api_router.post("/stores/nearby", response_model=List[StoreInfo])
async def get_nearby_stores(input: NearbyStoresRequest, current_user: dict = Depends(get_current_user)):
    if not gmaps:
        raise HTTPException(status_code=503, detail="Google Places API not configured")
    
    try:
        location = (input.lat, input.lng)
        stores = []
        
        # Search for different store types
        store_types_to_search = [
            ("supermarket", "supermarket"),
            ("gas_station", "gas station"),
            ("convenience_store", "convenience store"),
            ("pharmacy", "pharmacy"),
            ("food", "dollar store")
        ]
        
        for store_type, search_query in store_types_to_search:
            try:
                results = gmaps.places_nearby(
                    location=location,
                    radius=5000,  # 5km radius
                    type=store_type if store_type != "food" else None,
                    keyword=search_query
                )
                
                for place in results.get('results', [])[:2]:  # Top 2 per type
                    # Calculate distance
                    place_location = place['geometry']['location']
                    distance = gmaps.distance_matrix(
                        origins=[location],
                        destinations=[(place_location['lat'], place_location['lng'])],
                        mode="driving"
                    )
                    
                    distance_meters = 0
                    if distance['rows'] and distance['rows'][0]['elements']:
                        distance_meters = distance['rows'][0]['elements'][0].get('distance', {}).get('value', 0)
                    
                    stores.append(StoreInfo(
                        place_id=place['place_id'],
                        name=place['name'],
                        address=place.get('vicinity', ''),
                        lat=place_location['lat'],
                        lng=place_location['lng'],
                        distance=distance_meters,
                        store_type=store_type,
                        open_now=place.get('opening_hours', {}).get('open_now')
                    ))
            except Exception as e:
                logger.warning(f"Failed to fetch {store_type}: {str(e)}")
                continue
        
        # Sort by distance and return top 5
        stores.sort(key=lambda x: x.distance)
        return stores[:5]
        
    except Exception as e:
        logger.error(f"Nearby stores error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to fetch nearby stores: {str(e)}")

@api_router.get("/stores/{store_type}/recipes", response_model=List[RecipeResponse])
async def get_recipes_for_store(
    store_type: str,
    current_user: dict = Depends(get_current_user),
    microwave_only: bool = False
):
    # Get all recipes
    recipes = await db.recipes.find({}, {"_id": 0}).to_list(100)
    
    # Filter by store inventory
    filtered_recipes = []
    for recipe in recipes:
        if not recipe_matches_store_inventory(recipe, store_type):
            continue
        
        # Microwave filter (check if recipe has no cook time or mentions microwave)
        if microwave_only:
            instructions_text = " ".join(recipe.get('instructions', [])).lower()
            if recipe.get('cook_time', 0) > 5 and 'microwave' not in instructions_text:
                continue
        
        filtered_recipes.append(
            RecipeResponse(
                **{k: v for k, v in recipe.items() if k != 'saved_by'},
                is_saved=current_user['id'] in recipe.get('saved_by', []),
                created_at=datetime.fromisoformat(recipe['created_at']) if isinstance(recipe['created_at'], str) else recipe['created_at']
            )
        )
    
    return filtered_recipes

# ============== BIOMETRICS MODELS ==============

class BiometricData(BaseModel):
    model_config = ConfigDict(extra="ignore")
    
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str
    source: str  # "manual", "whoop", "apple_health", "google_health"
    recorded_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    
    # General metrics
    heart_rate: Optional[int] = None  # bpm
    resting_heart_rate: Optional[int] = None  # bpm
    hrv: Optional[float] = None  # ms
    sleep_hours: Optional[float] = None
    steps: Optional[int] = None
    active_calories: Optional[int] = None
    blood_oxygen: Optional[float] = None  # percentage
    
    # WHOOP specific
    recovery_score: Optional[int] = None  # 0-100
    strain_score: Optional[float] = None  # 0-21
    sleep_performance: Optional[int] = None  # percentage

class BiometricCreate(BaseModel):
    source: str = "manual"
    heart_rate: Optional[int] = None
    resting_heart_rate: Optional[int] = None
    hrv: Optional[float] = None
    sleep_hours: Optional[float] = None
    steps: Optional[int] = None
    active_calories: Optional[int] = None
    blood_oxygen: Optional[float] = None
    recovery_score: Optional[int] = None
    strain_score: Optional[float] = None
    sleep_performance: Optional[int] = None

class BiometricResponse(BaseModel):
    id: str
    source: str
    recorded_at: datetime
    heart_rate: Optional[int]
    resting_heart_rate: Optional[int]
    hrv: Optional[float]
    sleep_hours: Optional[float]
    steps: Optional[int]
    active_calories: Optional[int]
    blood_oxygen: Optional[float]
    recovery_score: Optional[int]
    strain_score: Optional[float]
    sleep_performance: Optional[int]

# ============== BIOMETRICS ROUTES ==============

@api_router.post("/biometrics/sync-wearable", response_model=BiometricResponse)
async def sync_wearable_data(input: BiometricCreate, current_user: dict = Depends(get_current_user)):
    """Sync biometric data from wearables or manual entry"""
    biometric = BiometricData(
        user_id=current_user['id'],
        **input.model_dump()
    )
    
    biometric_dict = biometric.model_dump()
    biometric_dict['recorded_at'] = biometric_dict['recorded_at'].isoformat()
    
    await db.biometrics.insert_one(biometric_dict)
    
    return BiometricResponse(**biometric.model_dump())

@api_router.get("/biometrics", response_model=List[BiometricResponse])
async def get_biometrics(
    current_user: dict = Depends(get_current_user),
    limit: int = 50
):
    biometrics = await db.biometrics.find(
        {"user_id": current_user['id']},
        {"_id": 0}
    ).sort("recorded_at", -1).limit(limit).to_list(limit)
    
    return [
        BiometricResponse(
            **{k: v for k, v in bio.items() if k != 'user_id'},
            recorded_at=datetime.fromisoformat(bio['recorded_at']) if isinstance(bio['recorded_at'], str) else bio['recorded_at']
        )
        for bio in biometrics
    ]

@api_router.get("/biometrics/latest", response_model=BiometricResponse)
async def get_latest_biometrics(current_user: dict = Depends(get_current_user)):
    biometric = await db.biometrics.find_one(
        {"user_id": current_user['id']},
        {"_id": 0},
        sort=[("recorded_at", -1)]
    )
    
    if not biometric:
        raise HTTPException(status_code=404, detail="No biometric data found")
    
    return BiometricResponse(
        **{k: v for k, v in biometric.items() if k != 'user_id'},
        recorded_at=datetime.fromisoformat(biometric['recorded_at']) if isinstance(biometric['recorded_at'], str) else biometric['recorded_at']
    )

@api_router.delete("/biometrics/{biometric_id}")
async def delete_biometric(biometric_id: str, current_user: dict = Depends(get_current_user)):
    result = await db.biometrics.delete_one({"id": biometric_id, "user_id": current_user['id']})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Biometric data not found")
    return {"message": "Biometric data deleted"}

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
