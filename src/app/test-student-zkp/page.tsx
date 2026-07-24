import { StudentDiscountVerification } from "@/components/student/StudentDiscountVerification";

export default function TestZKPPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-lg">
        <h1 className="text-2xl font-bold text-center mb-8">zk-SNARK Demo</h1>
        <StudentDiscountVerification />
      </div>
    </div>
  );
}
