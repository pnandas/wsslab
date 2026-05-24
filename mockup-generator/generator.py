import time
import json
import random
import math
import logging
import threading
from fastapi import FastAPI, BackgroundTasks, Body
from pydantic import BaseModel
import pika

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mockup-generator")

app = FastAPI()

RABBITMQ_HOST = 'rabbitmq'
QUEUE_NAME = 'location_updates'

# Simulated drivers details
drivers = [
    {
        "id": "driver_1",
        "name": "Alice (Tesla Model S)",
        "lat_center": 48.8584,
        "lng_center": 2.2945,
        "speed_factor": 0.05,
        "radius": 0.004,
        "base_speed": 42
    },
    {
        "id": "driver_2",
        "name": "Bob (BMW i4)",
        "lat_center": 48.8606,
        "lng_center": 2.3376,
        "speed_factor": 0.07,
        "radius": 0.003,
        "base_speed": 35
    },
    {
        "id": "driver_3",
        "name": "Charlie (Audi e-tron)",
        "lat_center": 48.8738,
        "lng_center": 2.2950,
        "speed_factor": 0.04,
        "radius": 0.005,
        "base_speed": 50
    }
]

# Track active simulations (default: all inactive in v2, triggered by REST api)
active_simulations = {
    "driver_1": False,
    "driver_2": False,
    "driver_3": False
}

class StartStopRequest(BaseModel):
    driver_id: str

def get_rabbitmq_connection():
    while True:
        try:
            logger.info("Mockup Generator: Attempting to connect to RabbitMQ...")
            connection = pika.BlockingConnection(pika.ConnectionParameters(
                host=RABBITMQ_HOST,
                connection_attempts=3,
                retry_delay=2
            ))
            logger.info("Mockup Generator: Successfully connected to RabbitMQ!")
            return connection
        except pika.exceptions.AMQPConnectionError as e:
            logger.error(f"Mockup Generator: RabbitMQ not available yet ({e}). Retrying in 3 seconds...")
            time.sleep(3)

def run_simulation():
    connection = get_rabbitmq_connection()
    channel = connection.channel()
    channel.queue_declare(queue=QUEUE_NAME, durable=True)
    
    step = 0
    while True:
        try:
            step += 1
            any_active = False
            for driver in drivers:
                driver_id = driver["id"]
                
                # Only publish if this driver's simulation has been started
                if not active_simulations.get(driver_id, False):
                    continue
                
                any_active = True
                # Calculate movement along a figure-8 path
                angle = step * driver["speed_factor"]
                lat = driver["lat_center"] + driver["radius"] * math.sin(angle)
                lng = driver["lng_center"] + driver["radius"] * math.cos(angle * 1.5)
                
                # Add minor GPS jitter
                lat += random.uniform(-0.0001, 0.0001)
                lng += random.uniform(-0.0001, 0.0001)
                
                # Vary speed slightly
                speed = int(driver["base_speed"] + random.uniform(-5, 5))
                
                payload = {
                    "driver_id": driver_id,
                    "name": driver["name"],
                    "lat": round(lat, 6),
                    "lng": round(lng, 6),
                    "speed": speed,
                    "status": "active" if random.random() > 0.02 else "idle",
                    "timestamp": int(time.time())
                }
                
                message = json.dumps(payload)
                
                channel.basic_publish(
                    exchange='',
                    routing_key=QUEUE_NAME,
                    body=message,
                    properties=pika.BasicProperties(
                        delivery_mode=2,  # make message persistent
                    )
                )
                logger.info(f"Published: {driver['name']} at ({payload['lat']}, {payload['lng']})")
            
            # Wait 1.5 seconds between ticks
            time.sleep(1.5)
            
        except pika.exceptions.AMQPConnectionError:
            logger.warn("Mockup Generator: Connection lost! Reconnecting...")
            connection = get_rabbitmq_connection()
            channel = connection.channel()
            channel.queue_declare(queue=QUEUE_NAME, durable=True)
        except Exception as e:
            logger.error(f"Mockup Generator error in loop: {e}")
            time.sleep(2)

# Start simulation thread on startup
@app.on_event("startup")
def startup_event():
    thread = threading.Thread(target=run_simulation, daemon=True)
    thread.start()
    logger.info("Started background simulation thread.")

@app.post("/simulator/start")
def start_simulator(req: StartStopRequest):
    driver_id = req.driver_id
    if driver_id not in active_simulations:
        return {"status": "error", "message": "Invalid driver ID"}
    
    active_simulations[driver_id] = True
    logger.info(f"Started simulation feed for {driver_id}")
    return {"status": "started", "driver_id": driver_id}

@app.post("/simulator/stop")
def stop_simulator(req: StartStopRequest):
    driver_id = req.driver_id
    if driver_id not in active_simulations:
        return {"status": "error", "message": "Invalid driver ID"}
    
    active_simulations[driver_id] = False
    logger.info(f"Stopped simulation feed for {driver_id}")
    return {"status": "stopped", "driver_id": driver_id}
