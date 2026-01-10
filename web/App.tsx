
import React, { useState } from 'react';
import { Trash2, Hammer } from 'lucide-react';
import { CanvasItem, PlanStep, ChatMessage } from './types';
import Canvas from './components/Canvas';
import Sidebar from './components/Sidebar';
import Toolbar from './components/Toolbar';
import HomePage from './components/HomePage';
import { generatePlan, generateImage, generateBrainstorm, refineContent, performResearch } from './services/gemini';

function App() {
  const [view, setView] = useState<'home' | 'canvas'>('home');
  const [items, setItems] = useState<CanvasItem[]>([]);
  const [plan, setPlan] = useState<PlanStep[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: window.innerWidth / 4, y: window.innerHeight / 4 });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const addWorkflow = () => {
    const newId = Math.random().toString(36).substr(2, 9);
    const newItem: CanvasItem = {
      id: newId,
      type: 'workflow',
      content: '',
      x: (-pan.x + window.innerWidth/2) / zoom - 250,
      y: (-pan.y + window.innerHeight/2) / zoom - 200,
      width: 500,
      height: 400,
      status: 'completed',
      zIndex: 100,
      layers: []
    };
    setItems(prev => [...prev, newItem]);
    setSelectedId(newId);
  };

  const addImageItem = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      const newId = Math.random().toString(36).substr(2, 9);
      const newItem: CanvasItem = {
        id: newId,
        type: 'image',
        content: content,
        x: (-pan.x + window.innerWidth/2) / zoom - 150,
        y: (-pan.y + window.innerHeight/2) / zoom - 150,
        width: 300,
        height: 300,
        status: 'completed',
        label: file.name,
        zIndex: 50,
        layers: []
      };
      setItems(prev => [...prev, newItem]);
      setSelectedId(newId);
    };
    reader.readAsDataURL(file);
  };

  const addTextItem = () => {
    const newId = Math.random().toString(36).substr(2, 9);
    const newItem: CanvasItem = {
      id: newId,
      type: 'text',
      content: '双击此处输入文字...',
      x: (-pan.x + window.innerWidth/2) / zoom - 100,
      y: (-pan.y + window.innerHeight/2) / zoom - 50,
      width: 250,
      height: 120,
      status: 'completed',
      label: '文本组件',
      zIndex: 60,
      layers: []
    };
    setItems(prev => [...prev, newItem]);
    setSelectedId(newId);
  };

  const addMessage = (text: string, role: 'user' | 'assistant') => {
    setMessages(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), role, text, timestamp: Date.now() }]);
  };

  const handleUpdateItem = (id: string, updates: Partial<CanvasItem>) => {
    setItems(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  const handleAddItem = (item: CanvasItem) => {
    setItems(prev => [...prev, item]);
    setSelectedId(item.id);
  };

  const executePlan = async (steps: any[]) => {
    const newSteps: PlanStep[] = steps.map(s => ({
      id: Math.random().toString(36).substr(2, 9),
      title: s.title,
      description: s.description,
      status: 'pending',
      type: s.type,
      imagePrompt: s.imagePrompt
    }));
    setPlan(newSteps);
    
    const spacing = 450;
    const itemsPerRow = 3;
    const startX = (-pan.x + 100) / zoom;
    const startY = (-pan.y + 100) / zoom;

    const imageSteps = newSteps.filter(s => s.type === 'generate_image' || s.type === 'workflow');
    const placeholders: CanvasItem[] = imageSteps.map((s, index) => ({
      id: s.id,
      type: s.type === 'generate_image' ? 'image' : 'workflow',
      content: '',
      x: startX + (index % itemsPerRow) * spacing,
      y: startY + Math.floor(index / itemsPerRow) * spacing,
      width: 400,
      height: 400,
      status: 'loading',
      label: s.title,
      zIndex: 1,
      layers: []
    }));
    setItems(prev => [...prev, ...placeholders]);

    for (const step of newSteps) {
      setPlan(prev => prev.map(p => p.id === step.id ? { ...p, status: 'running' } : p));
      try {
        if (step.type === 'generate_image') {
          const img = await generateImage(step.imagePrompt || step.description, 'none');
          handleUpdateItem(step.id, { content: img, status: 'completed' });
        } else if (step.type === 'research') {
          const research = await performResearch(step.description);
          addMessage(`**${step.title} 研究结果：**\n\n${research.text}`, 'assistant');
        } else if (step.type === 'brainstorm') {
          const text = await generateBrainstorm(step.title, step.description);
          addMessage(`**${step.title} 方案：**\n\n${text}`, 'assistant');
        } else if (step.type === 'workflow') {
           handleUpdateItem(step.id, { status: 'completed' });
        }
        setPlan(prev => prev.map(p => p.id === step.id ? { ...p, status: 'completed' } : p));
      } catch (e) {
        setPlan(prev => prev.map(p => p.id === step.id ? { ...p, status: 'error' } : p));
        if (imageSteps.some(s => s.id === step.id)) {
           handleUpdateItem(step.id, { status: 'error' });
        }
      }
    }
  };

  const startGeneration = async (prompt: string) => {
    setView('canvas');
    addMessage(prompt, 'user');
    setIsThinking(true);
    try {
      const result = await generatePlan(prompt);
      if (result.steps?.length) {
        addMessage(`灵匠正在为您规划创作方案，图片将显示在画布上，详细研究与文案将显示在此处。`, 'assistant');
        executePlan(result.steps);
      }
    } finally { setIsThinking(false); }
  };

  if (view === 'home') {
    return <HomePage onStart={startGeneration} onEnterCanvas={() => setView('canvas')} />;
  }

  return (
    <div className="flex h-screen bg-[#fcfcfc] overflow-hidden font-sans text-gray-900">
      <div className="flex-1 relative flex flex-col">
        <header className="absolute top-0 left-0 right-0 h-16 bg-white/80 backdrop-blur-3xl border-b border-gray-100 px-6 flex items-center justify-between z-30">
          <div className="flex items-center gap-4">
            <button onClick={() => setView('home')} className="flex items-center gap-3 group">
              <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform">
                <Hammer className="text-white" size={18} />
              </div>
              <div className="flex flex-col -gap-1 text-left">
                <span className="font-black text-lg tracking-tighter text-gray-900 leading-none">灵匠</span>
                <span className="text-[7px] font-black uppercase tracking-widest text-gray-400">Project Space</span>
              </div>
            </button>
            <div className="hidden md:flex items-center gap-4 text-[9px] font-black uppercase tracking-[0.2em] text-gray-300 ml-4">
              <span>正在工作</span>
              <div className="w-1 h-1 rounded-full bg-indigo-400" />
              <span>灵动实验室</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => { if(confirm('确定清空匠心画布吗？')) { setItems([]); setPlan([]); setMessages([]); } }} className="p-2 text-gray-300 hover:text-red-500 rounded-xl transition-all"><Trash2 size={18} /></button>
            <div className="h-4 w-[1px] bg-gray-100 mx-1" />
            <button className="px-5 py-2 text-xs font-black bg-black text-white rounded-xl shadow-lg hover:opacity-90 active:scale-95 transition-all uppercase tracking-widest">
              交付作品
            </button>
          </div>
        </header>

        <Canvas 
          items={items} zoom={zoom} pan={pan} onPanChange={setPan} onItemUpdate={handleUpdateItem}
          onItemDelete={(id) => { setItems(prev => prev.filter(i => i.id !== id)); setSelectedId(null); }}
          onItemAdd={handleAddItem}
          selectedId={selectedId} setSelectedId={setSelectedId}
        />
        
        <Toolbar 
          zoom={zoom} 
          onZoomChange={setZoom} 
          onResetView={() => { setZoom(1); setPan({ x: window.innerWidth / 4, y: window.innerHeight / 4 }); }}
          onAddWorkflow={addWorkflow}
          onAddImage={addImageItem}
          onAddText={addTextItem}
        />
      </div>

      <Sidebar messages={messages} plan={plan} isThinking={isThinking} onSendMessage={async (t) => {
        addMessage(t, 'user');
        setIsThinking(true);
        try {
          const result = await generatePlan(t);
          if (result.steps?.length) {
            executePlan(result.steps);
          }
        } finally { setIsThinking(false); }
      }} />
    </div>
  );
}

export default App;
