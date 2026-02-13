from typing import Optional
from sqlmodel import Field, SQLModel, create_engine, Session
from datetime import datetime

class User(SQLModel, table=True):
    openid: str = Field(primary_key=True)
    nickname: str
    avatar_url: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())

class LearningRecord(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_name: str = Field(index=True) # Kept for display/historical reasons
    openid: Optional[str] = Field(index=True, default=None) # Link to User
    word: str
    source_level: str
    meaning: str
    topic: str
    created_at: str  # ISO format datetime string

class QuizHistory(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_name: str = Field(index=True) # OpenID
    topic: str
    level: str
    score: int
    created_at: str = Field(default_factory=lambda: datetime.now().isoformat())

class Vocabulary(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    word: str = Field(index=True)
    meaning: str
    level: str = Field(index=True)

sqlite_file_name = "database.db"
sqlite_url = f"sqlite:///{sqlite_file_name}"

engine = create_engine(sqlite_url)

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)

def get_session():
    with Session(engine) as session:
        yield session
