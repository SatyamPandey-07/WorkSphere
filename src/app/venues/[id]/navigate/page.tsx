import NavigationContainer from "@/components/ar/NavigationContainer";

export default function ARNavigatePage() {
  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] p-4 md:p-8 max-w-7xl mx-auto w-full relative">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold">Venue Navigation</h1>
          <p className="text-slate-400">Find your way indoors</p>
        </div>
      </div>

      <div className="flex-1 relative rounded-xl overflow-hidden shadow-2xl border border-slate-800 bg-slate-950 flex items-center justify-center">
        <NavigationContainer />
      </div>
    </div>
  );
}
