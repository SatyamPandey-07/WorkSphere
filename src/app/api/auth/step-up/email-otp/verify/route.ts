import { verifyStepUpEmailOtpHandler } from "@/lib/auth/stepUpOtpService";

export async function POST(req: Request) {
  return verifyStepUpEmailOtpHandler(req);
}
