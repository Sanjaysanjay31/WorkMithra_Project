import asyncio
import socketio

async def main():
    sio = socketio.AsyncClient()
    await sio.connect('http://127.0.0.1:8000')
    print('Connected, sid:', sio.sid)
    # Authenticate with a test user ID
    await sio.emit('authenticate', {'user_id': 1})
    await asyncio.sleep(1)
    await sio.disconnect()
    print('Disconnected')

if __name__ == '__main__':
    asyncio.run(main())
