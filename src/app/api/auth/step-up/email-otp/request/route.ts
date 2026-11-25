import { requestStepUpEmailOtpHandler } from "@/lib/auth/stepUpOtpService";

export async function POST(req: Request) {
  return requestStepUpEmailOtpHandler(req);
}
