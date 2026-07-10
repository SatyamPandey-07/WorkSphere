import { NextResponse } from "next/server";
import { z } from "zod";

const newsletterSchema = z.object({
  email: z.string().email("Please enter a valid email address."),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    
    // Validate request body
    const validation = newsletterSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.format().email?._errors[0] || "Invalid email" },
        { status: 400 }
      );
    }

    const { email } = validation.data;

    // Simulate network delay for UX loading state
    await new Promise((resolve) => setTimeout(resolve, 1200));

    // In a real application, you would connect to an email service provider
    // e.g., Resend, Mailchimp, ConvertKit, or save to your Prisma database:
    // await prisma.newsletterSubscriber.create({ data: { email } });
    console.log(`[Newsletter Subscription] New subscriber: ${email}`);

    return NextResponse.json(
      { message: "Thank you for subscribing! Check your inbox soon." },
      { status: 200 }
    );
  } catch (error) {
    console.error("Newsletter subscription error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again later." },
      { status: 500 }
    );
  }
}
