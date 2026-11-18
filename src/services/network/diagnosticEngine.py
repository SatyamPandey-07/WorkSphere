import asyncio
import random
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("DiagnosticEngine")

class DiagnosticEngine:
    async def ingest_telemetry(self):
        while True:
            latency = random.uniform(10.0, 150.0)
            packet_loss = random.uniform(0.0, 5.0)
            jitter = random.uniform(1.0, 20.0)
            
            logger.info(f"?? [Telemetry] Latency: {latency:.2f}ms | Loss: {packet_loss:.2f}% | Jitter: {jitter:.2f}ms")
            await asyncio.sleep(5)

if __name__ == "__main__":
    engine = DiagnosticEngine()
    asyncio.run(engine.ingest_telemetry())
