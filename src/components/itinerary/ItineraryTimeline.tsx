import React, { useState, useTransition } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

export interface ItineraryItem {
  id: string;
  venueName: string;
  timeSlot: string;
  category: 'coffee' | 'desk' | 'lounge';
  transitDurationMinutes?: number;
}

interface ItineraryTimelineProps {
  itineraryId: string;
  initialItems: ItineraryItem[];
  onSyncFailed?: (errorMsg: string) => void;
}

interface SortableItemProps {
  item: ItineraryItem;
  index: number;
}

const SortableItem: React.FC<SortableItemProps> = ({ item, index }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`bg-slate-900 border ${
        isDragging ? 'border-emerald-500 shadow-2xl scale-[1.02]' : 'border-slate-800'
      } rounded-2xl p-4 text-white flex items-center justify-between cursor-grab active:cursor-grabbing transition-colors`}
    >
      <div className="flex items-center gap-4">
        <span className="w-7 h-7 rounded-xl bg-slate-800 border border-slate-700/80 flex items-center justify-center text-xs font-mono font-bold text-slate-400">
          {index + 1}
        </span>
        <div>
          <h4 className="text-sm font-bold text-slate-100">{item.venueName}</h4>
          <span className="text-xs text-slate-400 font-mono">{item.timeSlot}</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {item.transitDurationMinutes !== undefined && index > 0 && (
          <span className="text-[10px] font-mono px-2.5 py-1 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
            ~{item.transitDurationMinutes}m transit
          </span>
        )}
        <span className="text-slate-600 hover:text-slate-400">⠿</span>
      </div>
    </div>
  );
};

export const ItineraryTimeline: React.FC<ItineraryTimelineProps> = ({
  itineraryId,
  initialItems,
  onSyncFailed,
}) => {
  const [items, setItems] = useState<ItineraryItem[]>(initialItems);
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((item) => item.id === active.id);
    const newIndex = items.findIndex((item) => item.id === over.id);

    const reorderedItems = arrayMove(items, oldIndex, newIndex);

    // Recalculate mock transit durations based on new sequence order
    const updatedItems = reorderedItems.map((item, idx) => ({
      ...item,
      transitDurationMinutes: idx === 0 ? 0 : Math.floor(10 + Math.random() * 20),
    }));

    const previousItems = items;

    // 1. Apply optimistic state update immediately
    setItems(updatedItems);
    setErrorMessage(null);

    // 2. Sync asynchronously to server via PUT /api/itinerary/[id]
    startTransition(async () => {
      try {
        const response = await fetch(`/api/itinerary/${itineraryId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: updatedItems }),
        });

        if (!response.ok) {
          throw new Error('Failed to synchronize itinerary sequence with server.');
        }
      } catch (err) {
        // Roll back optimistic state on error
        setItems(previousItems);
        const errorText = err instanceof Error ? err.message : 'Network synchronization error.';
        setErrorMessage(errorText);
        if (onSyncFailed) onSyncFailed(errorText);
      }
    });
  };

  return (
    <div className="bg-slate-950 border border-slate-900 rounded-3xl p-6 text-white shadow-2xl max-w-xl mx-auto space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-slate-900">
        <h3 className="text-base font-bold tracking-tight text-slate-100">Workday Hop Itinerary</h3>
        {isPending && (
          <span className="text-xs font-mono text-amber-400 animate-pulse">Syncing changes...</span>
        )}
      </div>

      {errorMessage && (
        <div className="p-3 rounded-xl bg-rose-500/20 border border-rose-500/40 text-rose-300 text-xs animate-fadeIn">
          ⚠️ {errorMessage} (Reverted to previous sequence)
        </div>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {items.map((item, index) => (
              <SortableItem key={item.id} item={item} index={index} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
};

export default ItineraryTimeline;
