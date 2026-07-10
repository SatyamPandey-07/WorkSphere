import fetch from 'node-fetch';

async function testChat() {
  const req = {
    messages: [
      { role: 'user', content: 'I am looking for a place to work today. Also, please remember that I am a vegetarian and I always prefer quiet places with fast wifi' }
    ],
    location: { lat: 37.7749, lng: -122.4194 }
  };

  const res = await fetch('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req)
  });

  const text = await res.text();
  try {
    const data = JSON.parse(text);
    console.log(JSON.stringify(data.agentSteps, null, 2));
  } catch {
    console.log("Server returned an error instead of JSON:");
    console.log(text.substring(0, 500)); // Print first 500 chars of HTML
  }
}

testChat();
