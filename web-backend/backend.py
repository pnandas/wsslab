import os
import uuid
import logging
import requests
import redis
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("web-backend")

app = FastAPI()

# Connect to Redis
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
r = redis.Redis(host=REDIS_HOST, port=6379, decode_responses=True)

# Mockup Generator API endpoint
GENERATOR_API_URL = os.getenv("GENERATOR_API_URL", "http://mockup-generator:5001")

# Static list of drivers
DRIVERS = {
    "driver_1": "Alice (Tesla Model S)",
    "driver_2": "Bob (BMW i4)",
    "driver_3": "Charlie (Audi e-tron)"
}

class EndRideRequest(BaseModel):
    order_id: str

@app.post("/api/request-ride")
def request_ride(x_user_id: str = Header(None)):
    if not x_user_id:
        raise HTTPException(status_code=401, detail="Unauthorized: Missing identity header from Gateway")
        
    user_id = x_user_id
    logger.info(f"Received ride request for authenticated user: {user_id}")
    
    # 1. Check if user already has an active order
    existing_order_id = r.get(f"user:{user_id}:order")
    if existing_order_id:
        driver_id = r.get(f"order:{existing_order_id}:driver")
        if driver_id:
            logger.info(f"User {user_id} already has active order {existing_order_id}")
            return {
                "order_id": existing_order_id,
                "driver_id": driver_id,
                "driver_name": DRIVERS.get(driver_id, "Unknown Driver")
            }

    # 2. Find an available driver
    assigned_driver_id = None
    for driver_id in DRIVERS.keys():
        current_order = r.get(f"driver:{driver_id}:order")
        if not current_order:
            assigned_driver_id = driver_id
            break
            
    if not assigned_driver_id:
        raise HTTPException(status_code=400, detail="No drivers are currently available. Please try again later.")

    # 3. Create order mappings in Redis
    order_id = f"order_{uuid.uuid4().hex[:8]}"
    r.set(f"driver:{assigned_driver_id}:order", order_id)
    r.set(f"order:{order_id}:driver", assigned_driver_id)
    r.set(f"user:{user_id}:order", order_id)
    r.set(f"order:{order_id}:user", user_id)

    # 4. Trigger simulation on mockup-generator
    try:
        logger.info(f"Triggering mockup-generator to start simulation for {assigned_driver_id}")
        resp = requests.post(f"{GENERATOR_API_URL}/simulator/start", json={"driver_id": assigned_driver_id}, timeout=5)
        if resp.status_code != 202 and resp.status_code != 200:
            logger.error(f"Failed to trigger generator: {resp.text}")
    except Exception as e:
        logger.error(f"Error contacting mockup-generator: {e}")

    return {
        "order_id": order_id,
        "driver_id": assigned_driver_id,
        "driver_name": DRIVERS[assigned_driver_id]
    }

@app.post("/api/end-ride")
def end_ride(req: EndRideRequest, x_user_id: str = Header(None)):
    if not x_user_id:
        raise HTTPException(status_code=401, detail="Unauthorized: Missing identity header from Gateway")
        
    order_id = req.order_id
    user_id = x_user_id
    logger.info(f"Received end ride request for order {order_id} by user {user_id}")
    
    # 1. Verify order exists and matches user
    associated_user = r.get(f"order:{order_id}:user")
    if not associated_user:
        raise HTTPException(status_code=404, detail="Order not found or already ended")
        
    if associated_user != user_id:
        raise HTTPException(status_code=403, detail="Forbidden: You cannot end another user's ride")
        
    driver_id = r.get(f"order:{order_id}:driver")
    if not driver_id:
        raise HTTPException(status_code=404, detail="Driver mapping not found")

    # 2. Delete Redis mappings
    r.delete(f"driver:{driver_id}:order")
    r.delete(f"order:{order_id}:driver")
    r.delete(f"user:{user_id}:order")
    r.delete(f"order:{order_id}:user")

    # 3. Trigger simulation stop on mockup-generator
    try:
        logger.info(f"Triggering mockup-generator to stop simulation for {driver_id}")
        resp = requests.post(f"{GENERATOR_API_URL}/simulator/stop", json={"driver_id": driver_id}, timeout=5)
        if resp.status_code != 200:
            logger.error(f"Failed to stop generator: {resp.text}")
    except Exception as e:
        logger.error(f"Error contacting mockup-generator: {e}")

    return {"status": "success"}

@app.get("/api/admin/active-simulations")
def get_active_simulations(x_user_role: str = Header(None)):
    # Role-Based Access Control (RBAC) check
    if x_user_role != "admin":
        logger.warning(f"Unauthorized access attempt to admin endpoint. Role: {x_user_role}")
        raise HTTPException(status_code=403, detail="Forbidden: Admin privileges required")
        
    # Return mapping of all active driver-order statuses
    active = {}
    for driver_id, name in DRIVERS.items():
        order_id = r.get(f"driver:{driver_id}:order")
        user_id = r.get(f"order:{order_id}:user") if order_id else None
        active[driver_id] = {
            "name": name,
            "order_id": order_id,
            "user_id": user_id,
            "status": "busy" if order_id else "idle"
        }
    return active
