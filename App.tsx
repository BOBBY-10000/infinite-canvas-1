/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trash2, EyeOff, Copy, X } from 'lucide-react';

interface NodeData {
  id: string;
  x: number;
  y: number;
  type: 'sticky' | 'flashcard';
  content: string;
  backContent?: string;
  isHidden: boolean;
  isFlipped: boolean;
}

interface ModalConfig {
  isOpen: boolean;
  title: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  placeholder?: string;
}

export default function App() {
  const [nodes, setNodes] = useState<NodeData[]>([]);
  const [camera, setCamera] = useState({ x: -2500 + window.innerWidth / 2, y: -2500 + window.innerHeight / 2, scale: 1 });
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const [menuNodeId, setMenuNodeId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [modal, setModal] = useState<ModalConfig>({
    isOpen: false,
    title: '',
    onSubmit: () => {},
    onCancel: () => {},
  });

  const canvasRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastInteraction = useRef({ x: 0, y: 0, moved: false, initialDist: 0, initialScale: 1 });
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const tapState = useRef({ count: 0, last: 0, timer: null as NodeJS.Timeout | null });

  // Helper: Client screen to World coordinates
  const worldPos = useCallback((clientX: number, clientY: number) => {
    return {
      x: (clientX - camera.x) / camera.scale,
      y: (clientY - camera.y) / camera.scale,
    };
  }, [camera]);

  const openModalPrompt = (title: string, placeholder = "Type here..."): Promise<string | null> => {
    return new Promise((resolve) => {
      setModal({
        isOpen: true,
        title,
        placeholder,
        onSubmit: (val) => {
          setModal(m => ({ ...m, isOpen: false }));
          resolve(val);
        },
        onCancel: () => {
          setModal(m => ({ ...m, isOpen: false }));
          resolve(null);
        }
      });
    });
  };

  const createNode = async (clientX: number, clientY: number, type: 'sticky' | 'flashcard') => {
    const pos = worldPos(clientX, clientY);
    let content = '';
    let backContent = '';

    if (type === 'sticky') {
      const res = await openModalPrompt("Sticky Note");
      if (!res) return;
      content = res;
    } else {
      const front = await openModalPrompt("Front Side");
      if (!front) return;
      const back = await openModalPrompt("Back Side");
      if (!back) return;
      content = front;
      backContent = back;
    }

    const newNode: NodeData = {
      id: Math.random().toString(36).substr(2, 9),
      x: pos.x - 75,
      y: pos.y - 50,
      type,
      content,
      backContent,
      isHidden: false,
      isFlipped: false,
    };
    setNodes(prev => [...prev, newNode]);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 1) {
      lastInteraction.current.moved = false;
      lastInteraction.current.x = e.clientX;
      lastInteraction.current.y = e.clientY;
    } else if (pointers.current.size === 2) {
      lastInteraction.current.moved = true;
      const pts = Array.from(pointers.current.values());
      lastInteraction.current.initialDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      lastInteraction.current.initialScale = camera.scale;
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;

    const prev = pointers.current.get(e.pointerId)!;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;

    const totalMove = Math.hypot(e.clientX - lastInteraction.current.x, e.clientY - lastInteraction.current.y);
    if (totalMove > 10) {
      lastInteraction.current.moved = true;
      // Only clear if we haven't actually started dragging yet
      if (!draggedNodeId) clearLongPress();
    }

    // Node Dragging
    if (draggedNodeId && pointers.current.size === 1) {
      const pos = worldPos(e.clientX, e.clientY);
      setNodes(prev => prev.map(n => n.id === draggedNodeId ? { ...n, x: pos.x - 75, y: pos.y - 50 } : n));
      return;
    }

    // Camera Pan
    if (pointers.current.size === 1 && lastInteraction.current.moved && !draggedNodeId) {
      setCamera(c => ({ ...c, x: c.x + dx, y: c.y + dy }));
    } 
    // Pinch Zoom
    else if (pointers.current.size === 2) {
      const pts = Array.from(pointers.current.values());
      const currentDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const oldScale = camera.scale;
      const newScale = Math.max(0.2, Math.min(5, lastInteraction.current.initialScale * (currentDist / lastInteraction.current.initialDist)));
      
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;

      setCamera(c => ({
        scale: newScale,
        x: midX - (midX - c.x) * (newScale / oldScale),
        y: midY - (midY - c.y) * (newScale / oldScale)
      }));
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    const wasDragging = !!draggedNodeId;
    clearLongPress();
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      setDraggedNodeId(null);
    }

    if (!lastInteraction.current.moved && !wasDragging && pointers.current.size === 0) {
      handleTap(e.clientX, e.clientY);
    }
  };

  const handleTap = (x: number, y: number) => {
    const now = Date.now();
    if (now - tapState.current.last < 350) {
      tapState.current.count++;
    } else {
      tapState.current.count = 1;
    }
    tapState.current.last = now;

    if (tapState.current.timer) clearTimeout(tapState.current.timer);

    tapState.current.timer = setTimeout(() => {
      if (tapState.current.count === 2) createNode(x, y, 'sticky');
      if (tapState.current.count === 3) createNode(x, y, 'flashcard');
      tapState.current.count = 0;
    }, 350);
  };

  const handleNodePointerDown = (e: React.PointerEvent, node: NodeData) => {
    const { clientX, clientY } = e;
    
    // Set long press timer for drag & menu
    longPressTimer.current = setTimeout(() => {
      setDraggedNodeId(node.id);
      setMenuNodeId(node.id);
      setMenuPos({ x: clientX, y: clientY });
      navigator.vibrate?.(50); // Feedback if available
    }, 500);
  };

  const clearLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const toggleNodeContent = (nodeId: string) => {
    setNodes(prev => prev.map(n => {
      if (n.id !== nodeId) return n;
      if (n.isHidden) return { ...n, isHidden: false };
      if (n.type === 'flashcard') return { ...n, isFlipped: !n.isFlipped };
      return n;
    }));
  };

  const deleteNode = (id: string) => {
    setNodes(prev => prev.filter(n => n.id !== id));
    setMenuNodeId(null);
  };

  const toggleHide = (id: string) => {
    setNodes(prev => prev.map(n => n.id === id ? { ...n, isHidden: !n.isHidden } : n));
    setMenuNodeId(null);
  };

  const copyNode = (node: NodeData) => {
    const newNode: NodeData = {
      ...node,
      id: Math.random().toString(36).substr(2, 9),
      x: node.x + 30,
      y: node.y + 30,
    };
    setNodes(prev => [...prev, newNode]);
    setMenuNodeId(null);
  };

  // Close menu on click outside
  useEffect(() => {
    const handleGlobalClick = () => setMenuNodeId(null);
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, []);

  return (
    <div 
      ref={canvasRef}
      id="canvas"
      className="relative w-screen h-screen overflow-hidden bg-zinc-100 touch-none select-none"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onContextMenu={e => e.preventDefault()}
    >
      <div 
        id="world"
        className="absolute w-[5000px] h-[5000px] pointer-events-none"
        style={{
          transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`,
          transformOrigin: '0 0',
          backgroundImage: 'radial-gradient(rgba(0,0,0,0.1) 1px, transparent 1px)',
          backgroundSize: '30px 30px'
        }}
      >
        {nodes.map(node => (
          <div
            key={node.id}
            className={`node absolute w-[150px] min-h-[100px] p-4 flex items-center justify-center text-center font-bold break-words rounded-[20px] pointer-events-auto cursor-pointer transition-shadow node-shadow
              ${node.type === 'flashcard' ? 'bg-[#fff4e5] border-3 border-orange-400' : 'bg-white'}
              ${node.isHidden ? 'opacity-20' : 'opacity-100'}
              ${draggedNodeId === node.id ? 'dragging' : ''}
            `}
            style={{ left: node.x, top: node.y }}
            onPointerDown={(e) => handleNodePointerDown(e, node)}
            onClick={(e) => {
              e.stopPropagation();
              toggleNodeContent(node.id);
            }}
          >
            {node.type === 'flashcard' 
              ? (node.isFlipped ? node.backContent : node.content)
              : node.content
            }
          </div>
        ))}
      </div>

      {/* Floating Menu */}
      <AnimatePresence>
        {menuNodeId && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed z-[9999] bg-zinc-800 p-2 rounded-2xl grid grid-cols-3 gap-2 shadow-2xl"
            style={{ left: menuPos.x, top: menuPos.y - 120 }}
            onClick={e => e.stopPropagation()}
          >
            {(() => {
              const node = nodes.find(n => n.id === menuNodeId);
              if (!node) return null;
              return (
                <>
                  <button onClick={() => deleteNode(node.id)} className="node-menu-item flex flex-col items-center gap-1">
                    <Trash2 size={16} />
                    <span className="text-[10px]">Delete</span>
                  </button>
                  <button onClick={() => toggleHide(node.id)} className="node-menu-item flex flex-col items-center gap-1">
                    <EyeOff size={16} />
                    <span className="text-[10px]">{node.isHidden ? 'Show' : 'Hide'}</span>
                  </button>
                  <button onClick={() => copyNode(node)} className="node-menu-item flex flex-col items-center gap-1">
                    <Copy size={16} />
                    <span className="text-[10px]">Copy</span>
                  </button>
                </>
              );
            })()}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Custom Modal */}
      <AnimatePresence>
        {modal.isOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 flex items-center justify-center z-[10000] p-4"
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              className="bg-white rounded-3xl p-6 w-full max-w-[340px] shadow-2xl"
            >
              <h2 className="text-xl font-bold mb-4">{modal.title}</h2>
              <textarea
                autoFocus
                maxLength={80}
                placeholder={modal.placeholder}
                className="w-full min-h-[100px] bg-zinc-100 rounded-2xl p-4 outline-none resize-none text-zinc-900 text-lg mb-6"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    modal.onSubmit((e.target as HTMLTextAreaElement).value.trim());
                  }
                }}
              />
              <div className="flex gap-3">
                <button 
                  onClick={modal.onCancel}
                  className="flex-1 bg-zinc-100 text-zinc-900 font-bold py-3 rounded-2xl"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    const el = document.querySelector('textarea') as HTMLTextAreaElement;
                    modal.onSubmit(el.value.trim());
                  }}
                  className="flex-1 bg-zinc-900 text-white font-bold py-3 rounded-2xl"
                >
                  Confirm
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Guide UI */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-black/80 text-white px-4 py-2 rounded-full text-xs font-medium backdrop-blur-sm pointer-events-none">
        Double tap to Sticky • Triple tap to Flashcard • Hold to Drag & Menu
      </div>
    </div>
  );
}
