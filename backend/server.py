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
from datetime import datetime, timezone, timedelta
import jwt
from passlib.context import CryptContext
from emergentintegrations.llm.chat import LlmChat, UserMessage

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
