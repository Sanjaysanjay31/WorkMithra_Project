from pydantic import BaseModel, EmailStr
from typing import Optional

class UserCreate(BaseModel):
    full_name: str
    phone: str
    email: EmailStr
    password: str

    class Config:
        orm_mode = True

class UserLogin(BaseModel):
    identifier: str # Email or Phone
    password: str

class OTPRequest(BaseModel):
    email: EmailStr

class OTPVerify(BaseModel):
    email: EmailStr
    otp: str

class UserResponse(BaseModel):
    id: int
    full_name: str
    email: EmailStr
    phone: str

    class Config:
        orm_mode = True
