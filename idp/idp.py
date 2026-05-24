import os
import time
import logging
import jwt
from fastapi import FastAPI, Header, HTTPException, Response, Request
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mock-idp")

app = FastAPI()

# Shared JWT Secret (must match Centrifugo token_hmac_secret_key)
JWT_SECRET = os.getenv("JWT_SECRET", "secret-jwt-token-secret")
JWT_ALGORITHM = "HS256"

class TokenRequest(BaseModel):
    username: str
    password: str

@app.post("/oauth2/token")
def generate_token(req: TokenRequest):
    username = req.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="Username cannot be empty")
    
    # Simple role determination based on username
    role = "admin" if username.lower() == "admin" else "user"
    
    # Generate JWT payload
    payload = {
        "sub": username,                # User ID (Subject)
        "role": role,                   # Custom claim for authorization role
        "iat": int(time.time()),        # Issued at
        "exp": int(time.time()) + 3600  # Expires in 1 hour
    }
    
    # Sign JWT token
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)
    
    logger.info(f"Generated OAuth 2.0 token for user '{username}' with role '{role}'")
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": 3600,
        "role": role
    }

@app.get("/oauth2/validate")
def validate_token(
    response: Response,
    authorization: str = Header(None),
    x_token: str = Header(None)
):
    token = None
    
    # 1. Try to extract token from Authorization header
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization.split(" ")[1]
    
    # 2. Fallback: try to extract from X-Token header (passed from WebSocket query params)
    elif x_token:
        token = x_token
        
    if not token:
        logger.warning("Validation failed: No token provided in request")
        raise HTTPException(status_code=401, detail="Authentication token is missing")
        
    try:
        # Decode and verify JWT token
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        
        user_id = payload.get("sub")
        role = payload.get("role", "user")
        
        if not user_id:
            raise jwt.InvalidTokenError("Token is missing subject claim")
            
        # Set headers that Nginx will forward to backend microservices
        response.headers["X-User-Id"] = user_id
        response.headers["X-User-Role"] = role
        
        logger.info(f"Successfully validated token for user '{user_id}' ({role})")
        return {"status": "valid", "user_id": user_id, "role": role}
        
    except jwt.ExpiredSignatureError:
        logger.warning("Validation failed: Token has expired")
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError as e:
        logger.warning(f"Validation failed: Invalid token ({e})")
        raise HTTPException(status_code=401, detail="Invalid token signature or payload")
    except Exception as e:
        logger.error(f"Unexpected error during validation: {e}")
        raise HTTPException(status_code=500, detail="Internal token validation error")
