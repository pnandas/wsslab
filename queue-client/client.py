import os
import time
import json
import urllib.request
import urllib.error
import pika
import redis

RABBITMQ_HOST = 'rabbitmq'
QUEUE_NAME = 'location_updates'
CENTRIFUGO_API_URL = 'http://centrifugo:8000/api/publish'
CENTRIFUGO_API_KEY = 'secret-api-key'

# Connect to Redis
REDIS_HOST = os.getenv("REDIS_HOST", "redis")
r = redis.Redis(host=REDIS_HOST, port=6379, decode_responses=True)

def get_rabbitmq_connection():
    while True:
        try:
            print("Queue Client: Attempting to connect to RabbitMQ...", flush=True)
            connection = pika.BlockingConnection(pika.ConnectionParameters(
                host=RABBITMQ_HOST,
                connection_attempts=3,
                retry_delay=2
            ))
            print("Queue Client: Successfully connected to RabbitMQ!", flush=True)
            return connection
        except pika.exceptions.AMQPConnectionError as e:
            print(f"Queue Client: RabbitMQ not available yet ({e}). Retrying in 3 seconds...", flush=True)
            time.sleep(3)

def publish_to_centrifugo(channel, data):
    payload = {
        "channel": channel,
        "data": data
    }
    encoded_data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(
        CENTRIFUGO_API_URL,
        data=encoded_data,
        headers={
            'Content-Type': 'application/json',
            'X-API-Key': CENTRIFUGO_API_KEY
        },
        method='POST'
    )
    
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            status = response.status
            body = response.read().decode('utf-8')
            if status == 200:
                return True, body
            else:
                return False, f"HTTP status {status}: {body}"
    except urllib.error.URLError as e:
        return False, f"Network error: {e}"
    except Exception as e:
        return False, f"Unexpected error: {e}"

def callback(ch, method, properties, body):
    try:
        # Parse the JSON string from RabbitMQ
        payload = json.loads(body.decode('utf-8'))
        driver_id = payload.get("driver_id")
        print(f"Queue Client: Consumed update for {driver_id} at ({payload['lat']}, {payload['lng']})", flush=True)
        
        # 1. Look up active order in Redis
        order_id = r.get(f"driver:{driver_id}:order")
        
        success = True
        errors = []

        # 2. Forward to Admin monitoring channel (always)
        admin_success, admin_resp = publish_to_centrifugo("admin:updates", payload)
        if not admin_success:
            success = False
            errors.append(f"Admin channel error: {admin_resp}")

        # 3. Forward to specific User Order channel (if active ride)
        if order_id:
            payload["order_id"] = order_id
            order_success, order_resp = publish_to_centrifugo(f"orders:updates_{order_id}", payload)
            if not order_success:
                success = False
                errors.append(f"Order channel error: {order_resp}")
        else:
            print(f"Queue Client: Driver {driver_id} has no active order. Forwarding to admin only.", flush=True)

        if success:
            # Acknowledge the message
            ch.basic_ack(delivery_tag=method.delivery_tag)
        else:
            print(f"Queue Client: Failed to forward to Centrifugo: {', '.join(errors)}. Will retry.", flush=True)
            time.sleep(1)
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)
            
    except json.JSONDecodeError as e:
        print(f"Queue Client: JSON Decode Error: {e}. Rejecting message.", flush=True)
        ch.basic_reject(delivery_tag=method.delivery_tag, requeue=False)
    except Exception as e:
        print(f"Queue Client error in callback: {e}", flush=True)
        time.sleep(1)
        ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)

def main():
    while True:
        try:
            connection = get_rabbitmq_connection()
            channel = connection.channel()
            
            # Ensure the queue exists
            channel.queue_declare(queue=QUEUE_NAME, durable=True)
            
            # Set QOS prefetch limit to 1
            channel.basic_qos(prefetch_count=1)
            
            # Set up consumer
            channel.basic_consume(queue=QUEUE_NAME, on_message_callback=callback)
            
            print("Queue Client: Started consuming messages...", flush=True)
            channel.start_consuming()
            
        except pika.exceptions.AMQPConnectionError:
            print("Queue Client: Connection lost! Reconnecting...", flush=True)
            time.sleep(2)
        except Exception as e:
            print(f"Queue Client error in main loop: {e}", flush=True)
            time.sleep(2)

if __name__ == '__main__':
    main()
