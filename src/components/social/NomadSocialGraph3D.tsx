"use client";

import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { User, MapPin, Sparkles, X } from "lucide-react";

export interface GraphNode {
  id: string;
  name: string;
  type: "nomad" | "venue";
  skills?: string[];
  location?: string;
  val?: number;
}

export interface GraphLink {
  source: string;
  target: string;
  relationship: string;
}

export function NomadSocialGraph3D() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    let Graph: any = null;

    // Dynamically import to avoid SSR issues
    // @ts-ignore
    import("3d-force-graph").then((ForceGraph3DModule) => {
      const ForceGraph3D = ForceGraph3DModule.default || ForceGraph3DModule;

      const nodes: GraphNode[] = [];
      const links: GraphLink[] = [];

      const skillsList = ["React", "TypeScript", "Node.js", "Python", "Three.js", "AI/ML", "Solidity", "Tailwind"];
      const locations = ["Bali", "Lisbon", "Tokyo", "Mumbai", "Chiang Mai", "Berlin"];

      for (let i = 1; i <= 160; i++) {
        nodes.push({
          id: `nomad-${i}`,
          name: `Nomad ${i}`,
          type: "nomad",
          skills: [skillsList[i % skillsList.length], skillsList[(i + 2) % skillsList.length]],
          location: locations[i % locations.length],
          val: 3,
        });
      }

      for (let j = 1; j <= 40; j++) {
        nodes.push({
          id: `venue-${j}`,
          name: `CoWork Hub ${j}`,
          type: "venue",
          location: locations[j % locations.length],
          val: 6,
        });
      }

      for (let i = 1; i <= 160; i++) {
        const venueTarget = `venue-${(i % 40) + 1}`;
        links.push({
          source: `nomad-${i}`,
          target: venueTarget,
          relationship: "worked_at",
        });

        if (i % 3 === 0) {
          const peerTarget = `nomad-${((i + 5) % 160) + 1}`;
          links.push({
            source: `nomad-${i}`,
            target: peerTarget,
            relationship: "collaborated",
          });
        }
      }

      if (!containerRef.current) return;

      // Fix for TS2348: cast as any to invoke factory cleanly
      Graph = (ForceGraph3D as any)()(containerRef.current)
        .graphData({ nodes, links })
        .backgroundColor("#09090b")
        .nodeAutoColorBy("type")
        .nodeThreeObject((node: any) => {
          const isNomad = node.type === "nomad";
          const color = isNomad ? 0x00f0ff : 0xff007f;
          const geometry = isNomad
            ? new THREE.SphereGeometry(node.val || 3, 16, 16)
            : new THREE.BoxGeometry(6, 6, 6);

          const material = new THREE.MeshBasicMaterial({
            color,
            wireframe: !isNomad,
          });

          return new THREE.Mesh(geometry, material);
        })
        .linkColor(() => "rgba(0, 240, 255, 0.2)")
        .linkWidth(1.5)
        .linkDirectionalParticles(2)
        .linkDirectionalParticleWidth(2)
        .linkDirectionalParticleColor(() => "#00f0ff")
        .onNodeHover((node: any) => {
          setHoverNode(node || null);
          if (containerRef.current) {
            containerRef.current.style.cursor = node ? "pointer" : "default";
          }
        })
        .onNodeClick((node: any) => {
          setSelectedNode(node);
          const distance = 40;
          const distRatio = 1 + distance / Math.hypot(node.x, node.y, node.z);

          Graph.cameraPosition(
            { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
            node,
            2000
          );
        });
    });

    return () => {
      if (Graph && typeof Graph._destructor === "function") {
        Graph._destructor();
      }
    };
  }, []);

  return (
    <div className="relative w-full h-[calc(100vh-4rem)] bg-zinc-950 overflow-hidden">
      <div ref={containerRef} className="w-full h-full" />

      <div className="absolute top-4 left-4 z-10 bg-zinc-900/80 backdrop-blur-md border border-cyan-500/30 px-4 py-2 rounded-xl flex items-center gap-2 text-cyan-400 font-mono text-xs shadow-lg shadow-cyan-500/10">
        <Sparkles className="w-4 h-4 text-cyan-400 animate-pulse" />
        3D NOMAD SOCIAL MATRIX (200 NODES)
      </div>

      {hoverNode && !selectedNode && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 bg-zinc-900/90 backdrop-blur-md border border-zinc-800 px-4 py-2 rounded-lg text-xs font-mono text-zinc-300 pointer-events-none">
          <span className="text-cyan-400 font-bold">{hoverNode.name}</span> ({hoverNode.type}) — {hoverNode.location}
        </div>
      )}

      {selectedNode && (
        <div className="absolute top-4 right-4 z-20 w-80 bg-zinc-900/95 backdrop-blur-xl border border-cyan-500/40 p-5 rounded-2xl text-zinc-200 shadow-2xl shadow-cyan-500/20">
          <div className="flex items-center justify-between border-b border-zinc-800 pb-3 mb-3">
            <div className="flex items-center gap-2">
              {selectedNode.type === "nomad" ? (
                <User className="w-5 h-5 text-cyan-400" />
              ) : (
                <MapPin className="w-5 h-5 text-pink-500" />
              )}
              <h3 className="font-bold text-base text-white">{selectedNode.name}</h3>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              className="p-1 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3 text-xs font-mono">
            <div>
              <span className="text-zinc-500">TYPE:</span>{" "}
              <span className="text-cyan-400 uppercase font-semibold">{selectedNode.type}</span>
            </div>
            <div>
              <span className="text-zinc-500">LOCATION:</span>{" "}
              <span className="text-zinc-300">{selectedNode.location}</span>
            </div>
            {selectedNode.skills && (
              <div>
                <span className="text-zinc-500 block mb-1">SKILLS & TECH:</span>
                <div className="flex flex-wrap gap-1">
                  {selectedNode.skills.map((skill, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 bg-cyan-950/60 border border-cyan-500/30 text-cyan-300 rounded text-[10px]"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}