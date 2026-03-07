"use client";

import { Brain, Search, Database, Zap, Navigation, Terminal } from "lucide-react";
import { useEffect, useState } from "react";

const AGENTS = [
    { id: "Context", icon: Search, label: "Contextualizing Location", color: "text-blue-500", glow: "shadow-blue-500/50" },
    { id: "Data", icon: Database, label: "Gathering Venue Data", color: "text-green-500", glow: "shadow-green-500/50" },
    { id: "Reasoning", icon: Zap, label: "Scoring & Ranking", color: "text-orange-500", glow: "shadow-orange-500/50" },
    { id: "Action", icon: Navigation, label: "Generating Actions", color: "text-pink-500", glow: "shadow-pink-500/50" },
];

const TERMINAL_MESSAGES = [
    "Initializing Orchestrator node...",
    "Acquiring geolocation telemetry...",
    "Querying Overpass API for local hotspots...",
    "Parsing WiFi & noise floor metadata...",
    "Applying multi-weighted preference scoring...",
    "Calculating 'Focus-Mode' compatibility...",
    "Synthesizing results for WorkSphere AI...",
];

export function BrainTerminal() {
    const [activeStep, setActiveStep] = useState(0);
    const [logs, setLogs] = useState<string[]>([]);
    const [currentLog, setCurrentLog] = useState(0);

    // Animate nodes and logs while loading
    useEffect(() => {
        const nodeInterval = setInterval(() => {
            setActiveStep((prev) => (prev + 1) % AGENTS.length);
        }, 1500);

        const logInterval = setInterval(() => {
            setLogs((prev) => [...prev, TERMINAL_MESSAGES[currentLog]].slice(-4));
            setCurrentLog((prev) => (prev + 1) % TERMINAL_MESSAGES.length);
        }, 800);

        return () => {
            clearInterval(nodeInterval);
            clearInterval(logInterval);
        };
    }, [currentLog]);

    return (
        <div className="glass-card rounded-2xl p-6 glow-blue max-w-lg mx-auto overflow-hidden">
            <div className="flex items-center gap-3 mb-6 border-b border-white/10 pb-4">
                <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
                    <Brain className="w-5 h-5 text-blue-500 animate-pulse" />
                </div>
                <div>
                    <h3 className="text-sm font-bold uppercase tracking-tighter text-zinc-200">Neural Engine Replay</h3>
                    <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">Active Pipeline: Multi-Agent v2.0</p>
                </div>
            </div>

            {/* Nodes Visualization */}
            <div className="flex justify-between items-center relative px-4 mb-8">
                {/* Connection Line */}
                <div className="absolute top-1/2 left-0 right-0 h-[2px] bg-white/5 -translate-y-1/2 z-0" />

                {AGENTS.map((agent, i) => {
                    const Icon = agent.icon;
                    const isActive = i <= activeStep;
                    const isCurrent = i === activeStep;

                    return (
                        <div key={agent.id} className="relative z-10 flex flex-col items-center gap-2">
                            <div
                                className={`w-10 h-10 rounded-xl flex items-center justify-center border transition-all duration-500 ${isActive
                                        ? `bg-zinc-950 border-${agent.color.split('-')[1]}-500/50 ${agent.glow} shadow-lg scale-110`
                                        : "bg-zinc-900 border-white/5 opacity-40"
                                    }`}
                            >
                                <Icon className={`w-5 h-5 ${isActive ? agent.color : "text-zinc-500"}`} />

                                {isCurrent && (
                                    <span className={`absolute inset-0 rounded-xl animate-ping border ${agent.color.split('-')[1]}-500/20`} />
                                )}
                            </div>
                            <span className={`text-[8px] font-bold uppercase tracking-tighter ${isActive ? "text-zinc-300" : "text-zinc-600"}`}>
                                {agent.id}
                            </span>
                        </div>
                    );
                })}
            </div>

            {/* "Terminal" Log Output */}
            <div className="bg-black/40 rounded-xl p-4 border border-white/5 font-mono">
                <div className="flex items-center gap-2 mb-2">
                    <Terminal className="w-3 h-3 text-green-500" />
                    <span className="text-[9px] uppercase tracking-widest text-zinc-500 font-bold">Live Execution Logs</span>
                </div>
                <div className="space-y-1">
                    {logs.map((log, i) => (
                        <div key={i} className={`text-[10px] leading-relaxed ${i === logs.length - 1 ? "text-green-400" : "text-zinc-500 opacity-60"}`}>
                            <span className="text-green-800 mr-2 opacity-50">$</span>
                            {log}
                            {i === logs.length - 1 && <span className="inline-block w-1.5 h-3 bg-green-400 ml-1 animate-pulse" />}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
