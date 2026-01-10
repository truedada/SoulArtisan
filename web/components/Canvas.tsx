
import React, { useState, useRef, useEffect } from 'react';
import { CanvasItem } from '../types';
import { 
  Loader2, Trash2, Wand2, PenTool, Type, RotateCcw, 
  Sparkles, ChevronUp, ChevronDown, Download, RefreshCw, 
  MessageSquarePlus, Info, Scissors, Maximize2, Video, 
  Eraser, Sliders, Edit3, Square, MousePointer2, LassoSelect, 
  Check, X, Undo2, ChevronRight, Layers, Scan, Plus, Undo, Redo
} from 'lucide-react';
import { generateWorkflowImage, removeBackground } from '../services/gemini';

interface CanvasProps {
  items: CanvasItem[];
  zoom: number;
  pan: { x: number; y: number };
  onPanChange: (pan: { x: number; y: number }) => void;
  onItemUpdate: (id: string, updates: Partial<CanvasItem>) => void;
  onItemDelete: (id: string) => void;
  onItemAdd: (item: CanvasItem) => void; 
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
}

type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type EditTool = 'none' | 'brush' | 'eraser' | 'rect' | 'lasso' | 'quick' | 'cutout';

const Canvas: React.FC<CanvasProps> = ({ 
  items, zoom, pan, onPanChange, onItemUpdate, onItemDelete, onItemAdd, selectedId, setSelectedId 
}) => {
  const [dragState, setDragState] = useState<{ id: string, startX: number, startY: number } | null>(null);
  const [resizeState, setResizeState] = useState<{ 
    id: string, direction: ResizeDirection, startX: number, startY: number, 
    startW: number, startH: number, startItemX: number, startItemY: number
  } | null>(null);
  
  const [isPanning, setIsPanning] = useState(false);
  const [lastMousePos, setLastMousePos] = useState({ x: 0, y: 0 });
  
  // 图像编辑状态
  const [editTool, setEditTool] = useState<EditTool>('none');
  const [brushSize, setBrushSize] = useState(30);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawingMask, setIsDrawingMask] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  
  // 抠图专用状态
  const [isCutoutMode, setIsCutoutMode] = useState(false);

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, id: string } | null>(null);

  const selectedItem = items.find(i => i.id === selectedId);

  // 初始化抠图识别 (TFJS)
  const runSelfieSegmentation = async (imageElement: HTMLImageElement) => {
    // @ts-ignore
    const model = await window.selfieSegmentation.createModel();
    // @ts-ignore
    const segmentation = await model.segmentPeople(imageElement);
    return segmentation;
  };

  /**
   * 开启抠图模式并自动识别主体
   */
  const handleEnterCutoutMode = async () => {
    if (!selectedItem) return;
    setIsCutoutMode(true);
    setEditTool('cutout');
    setIsScanning(true);

    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = async () => {
        const canvas = maskCanvasRef.current;
        if (!canvas) return;
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 使用 TF.js 进行本地极速识别 (如果是人像)
        // 注意：Selfie Segmentation 主要是人像，Gemini 则更通用
        try {
          // @ts-ignore
          const model = await window.selfieSegmentation.createModel({
            runtime: 'mediapipe',
            modelType: 'general'
          });
          const segmentation = await model.segmentPeople(img);
          
          if (segmentation && segmentation.length > 0) {
            const mask = segmentation[0].mask;
            const maskImageData = await mask.toImageData();
            // 将识别到的遮罩绘制为蓝色
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = img.width;
            tempCanvas.height = img.height;
            const tempCtx = tempCanvas.getContext('2d')!;
            tempCtx.putImageData(maskImageData, 0, 0);

            ctx.globalCompositeOperation = 'source-over';
            ctx.fillStyle = 'rgba(99, 102, 241, 0.6)'; // 参考图中的蓝色遮罩色
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.globalCompositeOperation = 'destination-in';
            ctx.drawImage(tempCanvas, 0, 0);
          }
        } catch (tfError) {
          console.warn("TFJS 识别失败，降级到简单中心区域:", tfError);
          ctx.fillStyle = 'rgba(99, 102, 241, 0.4)';
          ctx.fillRect(canvas.width * 0.2, canvas.height * 0.1, canvas.width * 0.6, canvas.height * 0.8);
        }
        
        setIsScanning(false);
      };
      img.src = selectedItem.content;
    } catch (e) {
      console.error(e);
      setIsScanning(false);
    }
  };

  /**
   * 执行最终抠图
   */
  const handleConfirmCutout = async () => {
    if (!selectedItem) return;
    onItemUpdate(selectedId!, { status: 'loading' });
    setIsCutoutMode(false);
    setEditTool('none');

    try {
      // 1. 获取用户涂抹修正后的 Mask
      const maskCanvas = maskCanvasRef.current;
      if (!maskCanvas) return;

      // 2. 将原图与 Mask 结合，提取主体
      const finalCanvas = document.createElement('canvas');
      finalCanvas.width = selectedItem.width;
      finalCanvas.height = selectedItem.height;
      const fCtx = finalCanvas.getContext('2d')!;

      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        // 绘制 Mask 区域到 Alpha 通道
        fCtx.drawImage(maskCanvas, 0, 0, selectedItem.width, selectedItem.height);
        fCtx.globalCompositeOperation = 'source-in';
        fCtx.drawImage(img, 0, 0, selectedItem.width, selectedItem.height);
        
        const cutoutData = finalCanvas.toDataURL('image/png');
        onItemUpdate(selectedId!, { content: cutoutData, status: 'completed' });
      };
      img.src = selectedItem.content;

    } catch (e) {
      onItemUpdate(selectedId!, { status: 'error' });
    }
  };

  const handleMaskMouseDown = (e: React.MouseEvent) => {
    if (!selectedItem || editTool === 'none') return;
    e.stopPropagation();
    
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;

    setIsDrawingMask(true);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = brushSize;
      
      // 在抠图模式下，Brush 是增加选中区域，Eraser 是移除
      if (editTool === 'cutout') {
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(99, 102, 241, 0.6)';
      } else if (editTool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
      }
    }
  };

  const handleMaskMouseMove = (e: React.MouseEvent) => {
    if (!selectedItem || !isDrawingMask) return;
    const canvas = maskCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  };

  const startItemDrag = (e: React.MouseEvent, id: string) => {
    if (editTool !== 'none' || resizeState) return;
    e.stopPropagation();
    setSelectedId(id);
    setContextMenu(null);
    setDragState({ id, startX: e.clientX, startY: e.clientY });
    setLastMousePos({ x: e.clientX, y: e.clientY });
  };

  const adjustZIndex = (id: string, action: 'front' | 'back') => {
    const maxZ = Math.max(0, ...items.map(i => i.zIndex || 0));
    onItemUpdate(id, { zIndex: action === 'front' ? maxZ + 1 : -1 });
    setContextMenu(null);
  };

  return (
    <div 
      className="flex-1 relative overflow-hidden canvas-grid bg-[#f5f5f5] select-none"
      onMouseDown={(e) => {
        if (e.button === 0 && e.target === e.currentTarget) {
          setIsPanning(true);
          setLastMousePos({ x: e.clientX, y: e.clientY });
          setSelectedId(null);
          setContextMenu(null);
          setEditTool('none');
          setIsCutoutMode(false);
        }
      }}
      onMouseMove={(e) => {
        if (isPanning) {
          onPanChange({ x: pan.x + (e.clientX - lastMousePos.x), y: pan.y + (e.clientY - lastMousePos.y) });
          setLastMousePos({ x: e.clientX, y: e.clientY });
        } else if (resizeState) {
          const dx = (e.clientX - resizeState.startX) / zoom;
          const dy = (e.clientY - resizeState.startY) / zoom;
          const { direction, startW, startH, startItemX, startItemY } = resizeState;
          let { newW, newH, newX, newY } = { newW: startW, newH: startH, newX: startItemX, newY: startItemY };
          if (direction.includes('e')) newW = Math.max(150, startW + dx);
          if (direction.includes('s')) newH = Math.max(100, startH + dy);
          if (direction.includes('w')) { const delta = Math.min(startW - 150, dx); newW = startW - delta; newX = startItemX + delta; }
          if (direction.includes('n')) { const delta = Math.min(startH - 100, dy); newH = startH - delta; newY = startItemY + delta; }
          onItemUpdate(resizeState.id, { width: newW, height: newH, x: newX, y: newY });
        } else if (dragState) {
          const dx = (e.clientX - lastMousePos.x) / zoom;
          const dy = (e.clientY - lastMousePos.y) / zoom;
          const item = items.find(i => i.id === dragState.id);
          if (item) onItemUpdate(dragState.id, { x: item.x + dx, y: item.y + dy });
          setLastMousePos({ x: e.clientX, y: e.clientY });
        }
      }}
      onMouseUp={() => { setIsPanning(false); setDragState(null); setResizeState(null); setIsDrawingMask(false); }}
    >
      {/* 顶部主工具栏 - 常驻 */}
      {selectedItem?.type === 'image' && !isCutoutMode && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-1 px-1.5 py-1.5 bg-white border border-gray-100 rounded-2xl shadow-xl animate-in slide-in-from-top-4">
          <button onClick={() => setEditTool('brush')} className="flex items-center gap-2 px-4 py-2 hover:bg-gray-50 rounded-xl transition-all text-gray-700 font-bold text-sm group">
            <Edit3 size={16} className="text-indigo-500 group-hover:scale-110" />
            局部重绘
          </button>
          <div className="w-px h-5 bg-gray-100 mx-1" />
          <button 
            onClick={handleEnterCutoutMode}
            className="flex items-center gap-2 px-4 py-2 hover:bg-indigo-50 rounded-xl transition-all text-indigo-600 font-bold text-sm"
          >
            <Scissors size={16}/>抠图
          </button>
          <button className="flex items-center gap-2 px-4 py-2 hover:bg-gray-50 rounded-xl transition-all text-gray-700 font-bold text-sm"><Square size={16}/>扩图</button>
        </div>
      )}

      {/* 极速抠图工具栏 (参考图样式) */}
      {isCutoutMode && (
        <div className="fixed bottom-12 left-1/2 -translate-x-1/2 z-[300] flex items-center gap-4 p-2 bg-white/95 backdrop-blur-xl border border-gray-200 rounded-2xl shadow-2xl animate-in slide-in-from-bottom-4">
           <div className="flex bg-gray-50 p-1 rounded-xl gap-0.5">
             <button 
              onClick={() => setEditTool('cutout')} 
              className={`p-2.5 rounded-lg transition-all ${editTool === 'cutout' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-400'}`}
             >
               <PenTool size={18} />
             </button>
             <button 
              onClick={() => setEditTool('eraser')} 
              className={`p-2.5 rounded-lg transition-all ${editTool === 'eraser' ? 'bg-white shadow-sm text-indigo-600' : 'text-gray-400'}`}
             >
               <Eraser size={18} />
             </button>
           </div>
           
           <div className="flex items-center gap-3 pl-3 border-l border-gray-100">
             <Sliders size={14} className="text-gray-300" />
             <input 
              type="range" min="5" max="100" value={brushSize} 
              onChange={(e) => setBrushSize(parseInt(e.target.value))}
              className="w-24 accent-indigo-500 h-1"
             />
             <div className="flex gap-1 border-l border-gray-100 pl-3">
               <button className="p-2 text-gray-400 hover:text-gray-800"><Scan size={18}/></button>
               <button className="p-2 text-gray-400 hover:text-gray-800"><LassoSelect size={18}/></button>
             </div>
             <div className="w-px h-5 bg-gray-100 mx-1" />
             <button className="p-2 text-gray-400 hover:text-gray-800"><Undo size={18}/></button>
             <button className="p-2 text-gray-400 hover:text-gray-800"><Redo size={18}/></button>
           </div>

           <button 
            onClick={handleConfirmCutout}
            className="flex items-center gap-2 px-6 py-2.5 bg-black text-white rounded-xl font-black text-xs uppercase tracking-widest hover:scale-105 active:scale-95 transition-all shadow-xl"
           >
             <Sparkles size={16} /> 1 抠图
           </button>
        </div>
      )}

      <div className="absolute transition-transform duration-75" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
        {items.map((item) => (
          <div
            key={item.id}
            onMouseDown={(e) => startItemDrag(e, item.id)}
            onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, id: item.id }); }}
            className={`absolute rounded-[24px] transition-all duration-300 ${selectedId === item.id ? 'ring-2 ring-indigo-500 shadow-2xl' : 'shadow-lg'}`}
            style={{ left: item.x, top: item.y, width: item.width, height: item.height, zIndex: item.zIndex || 0 }}
          >
            <div className="w-full h-full rounded-[24px] overflow-hidden bg-white shadow-inner relative checkered-bg">
              {item.status === 'loading' ? (
                <div className="w-full h-full flex flex-col items-center justify-center bg-gray-50 z-20">
                  <Loader2 className="animate-spin text-gray-300 mb-2" />
                </div>
              ) : (
                <>
                  <img src={item.content} className="w-full h-full object-cover pointer-events-none" />
                  
                  {/* 抠图模式的尺寸显示 (参考图顶部) */}
                  {selectedId === item.id && isCutoutMode && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-white/90 px-2 py-0.5 rounded text-[10px] font-bold text-gray-500 shadow-sm border border-gray-100">
                      {Math.round(item.width)} × {Math.round(item.height)}
                    </div>
                  )}

                  {/* 扫描动画 */}
                  {selectedId === item.id && isScanning && <div className="scan-line" />}
                  
                  {/* 抠图编辑 Mask 层 */}
                  {selectedId === item.id && isCutoutMode && (
                    <div className="absolute inset-0 cursor-crosshair">
                      <canvas 
                        ref={maskCanvasRef}
                        width={item.width}
                        height={item.height}
                        className="w-full h-full absolute inset-0 mix-blend-screen opacity-80"
                        onMouseDown={handleMaskMouseDown}
                        onMouseMove={handleMaskMouseMove}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
            
            {/* 缩放句柄 */}
            {selectedId === item.id && !isCutoutMode && ['nw', 'ne', 'sw', 'se'].map(dir => (
              <div key={dir} className={`absolute w-3 h-3 bg-white rounded-full z-50 shadow-xl cursor-${dir}-resize`}
                style={{
                  top: dir.includes('n') ? -6 : 'auto', bottom: dir.includes('s') ? -6 : 'auto',
                  left: dir.includes('w') ? -6 : 'auto', right: dir.includes('e') ? -6 : 'auto'
                }}
                onMouseDown={(e) => { e.stopPropagation(); setResizeState({ id: item.id, direction: dir as any, startX: e.clientX, startY: e.clientY, startW: item.width, startH: item.height, startItemX: item.x, startItemY: item.y }); }}
              />
            ))}
          </div>
        ))}
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <div 
          className="fixed z-[300] w-48 bg-white border border-gray-100 rounded-2xl shadow-2xl p-1.5 flex flex-col animate-in zoom-in-95"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button onClick={() => adjustZIndex(contextMenu.id, 'front')} className="flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 rounded-xl text-sm font-bold text-gray-700 transition-colors">
            置于顶层 <ChevronUp size={16} />
          </button>
          <button onClick={() => adjustZIndex(contextMenu.id, 'back')} className="flex items-center justify-between px-3 py-2.5 hover:bg-gray-50 rounded-xl text-sm font-bold text-gray-700 transition-colors">
            置于底层 <ChevronDown size={16} />
          </button>
          <div className="h-px bg-gray-50 my-1 mx-2" />
          <button onClick={() => { onItemDelete(contextMenu.id); setContextMenu(null); }} className="flex items-center gap-3 px-3 py-2.5 hover:bg-red-50 rounded-xl text-sm font-bold text-red-500 transition-colors">
            <Trash2 size={16} /> 删除节点
          </button>
        </div>
      )}
    </div>
  );
};

export default Canvas;