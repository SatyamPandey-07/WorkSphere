/* eslint-disable */
const { PrismaClient } = require('@prisma/client');
const { Pool } = require('pg');
const { PrismaPg } = require('@prisma/adapter-pg');
const crypto = require('crypto');

// Load environment variables (assuming dotenv is installed, or Next.js envs)
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function run() {
  // 1. Get a test user
  let user = await prisma.user.findFirst();
  if (!user) {
    user = await prisma.user.create({ data: { id: 'test_user_' + Date.now() } });
  }

  const userId = user.id;
  const webhookUrl = "https://webhook.site/95849d40-13de-47ae-9775-602324bc6ad7";

  console.log(`Using userId: ${userId}`);

  // 2. Clear previous webhooks for this user to avoid noise
  await prisma.webhookEndpoint.deleteMany({ where: { userId } });

  // 3. Register the webhook
  await prisma.webhookEndpoint.create({
    data: {
      userId,
      url: webhookUrl,
      secret: 'whsec_' + crypto.randomBytes(24).toString('base64'),
      eventTypes: ['DOCUMENT_SIGNED']
    }
  });
  console.log(`Registered webhook endpoint for ${webhookUrl}`);

  // 4. Trigger the mock event via our Next.js API
  const testRes = await fetch(`http://localhost:3000/api/webhooks/test?userId=${userId}`, { method: 'POST' });
  const testData = await testRes.json();
  console.log('Trigger event response:', testData);

  // 5. Run the background worker
  const workerRes = await fetch('http://localhost:3000/api/webhooks/worker', { 
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.WORKER_SECRET || 'my-test-secret'}`
    }
  });
  const workerData = await workerRes.json();
  console.log('Worker response:', workerData);

  console.log('Done!');
}

run().catch(console.error).finally(() => prisma.$disconnect());
