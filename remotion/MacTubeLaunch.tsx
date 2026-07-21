import React from 'react';
import {
  AbsoluteFill,
  Audio,
  Easing,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {
  Check,
  ChevronDown,
  Download,
  Folder,
  Headphones,
  Link2,
  ListVideo,
  Plus,
  Settings,
  Sparkles,
  Video,
} from 'lucide-react';
import './trailer.css';

const clamp: Partial<Parameters<typeof interpolate>[3]> = {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
};

const fade = (frame: number, enter: number, exit: number) =>
  interpolate(frame, [enter, enter + 18, exit - 18, exit], [0, 1, 1, 0], clamp);

const Logo: React.FC<{size?: number; light?: boolean}> = ({size = 64, light = false}) => (
  <svg width={size} height={size} viewBox="0 0 257.43 255.08" aria-hidden="true">
    <path
      fill={light ? '#d7eef5' : '#73a7ba'}
      d="M191.63,0h-125.84C29.46,0,0,29.46,0,65.8v125.84c0,30.3,20.49,55.81,48.37,63.45V68.59c0-14.32,15.62-23.18,27.9-15.82l37.96,22.71c8.92,5.34,20.04,5.34,28.96,0l37.96-22.71c12.29-7.35,27.9,1.5,27.9,15.82v186.49c27.88-7.64,48.37-33.14,48.37-63.45v-125.84C257.43,29.46,227.97,0,191.63,0Z"
    />
    <path
      fill={light ? '#d7eef5' : '#73a7ba'}
      d="M161.33,149.46l-56.86-32.83c-5.59-3.23-12.57.81-12.57,7.26v65.65c0,6.45,6.98,10.48,12.57,7.26l56.86-32.83c5.59-3.23,5.59-11.29,0-14.51Z"
    />
  </svg>
);

const Desktop: React.FC = () => {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, 600], [0, 48]);
  return (
    <AbsoluteFill className="desktop">
      <div className="desktop-wash wash-one" style={{transform: `translate3d(${drift}px, ${-drift * 0.25}px, 0)`}} />
      <div className="desktop-wash wash-two" style={{transform: `translate3d(${-drift * 0.7}px, ${drift * 0.2}px, 0)`}} />
      <div className="desktop-grain" />
      <div className="menu-bar">
        <span className="apple-mark">●</span><b>MacTube</b><span>File</span><span>Edit</span><span>View</span><span>Window</span>
        <span className="menu-spacer" /><span>9:41</span>
      </div>
      <div className="dock">
        <div className="dock-dot" /><div className="dock-dot" /><div className="dock-app"><Logo size={43} /></div><div className="dock-dot" /><div className="dock-dot" />
      </div>
    </AbsoluteFill>
  );
};

const Opening: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const logoIn = spring({frame, fps, config: {damping: 16, stiffness: 100, mass: 0.8}});
  const textIn = spring({frame: frame - 16, fps, config: {damping: 18, stiffness: 90}});
  const out = interpolate(frame, [62, 82], [1, 0], clamp);
  return (
    <AbsoluteFill className="opening" style={{opacity: out}}>
      <div className="opening-orbit orbit-a" />
      <div className="opening-orbit orbit-b" />
      <div className="opening-logo" style={{transform: `scale(${interpolate(logoIn, [0, 1], [0.58, 1])})`, opacity: logoIn}}>
        <Logo size={144} light />
      </div>
      <div className="opening-copy" style={{opacity: textIn, transform: `translateY(${interpolate(textIn, [0, 1], [22, 0])}px)`}}>
        <span>Introducing</span>
        <h1>MacTube</h1>
      </div>
    </AbsoluteFill>
  );
};

const TrafficLights = () => (
  <div className="traffic"><i className="red" /><i className="yellow" /><i className="green" /></div>
);

const AppChrome: React.FC = () => (
  <div className="app-toolbar">
    <TrafficLights />
    <div className="app-brand"><Logo size={36} light /><strong>MacTube</strong></div>
    <div className="toolbar-spacer" />
    <div className="segmented"><span className="selected">Queue</span><span>History</span></div>
    <Settings size={24} strokeWidth={1.8} />
  </div>
);

const ModeControls: React.FC = () => (
  <div className="mode-controls">
    <div className="pill selected"><Video size={17} /> Video</div>
    <div className="pill"><Headphones size={17} /> Audio</div>
    <div className="pill quality">Best available <ChevronDown size={16} /></div>
    <div className="pill"><Folder size={17} /> MacTube</div>
  </div>
);

const InputMoment: React.FC<{frame: number}> = ({frame}) => {
  const typing = interpolate(frame, [130, 180], [0, 39], {...clamp, easing: Easing.inOut(Easing.quad)});
  const url = 'https://youtube.com/watch?v=daylight';
  const isAdded = frame >= 214;
  const press = interpolate(frame, [204, 210, 218], [1, 0.94, 1], clamp);
  return (
    <>
      <div className={`url-bar ${isAdded ? 'success' : ''}`}>
        <Link2 size={24} />
        <span>{url.slice(0, Math.floor(typing))}<i className="caret" /></span>
        <button style={{transform: `scale(${press})`}}>{isAdded ? <Check size={23} /> : <Plus size={23} />}{isAdded ? 'Added' : 'Add'}</button>
      </div>
      <ModeControls />
    </>
  );
};

const EmptyQueue: React.FC<{frame: number}> = ({frame}) => {
  const out = interpolate(frame, [210, 230], [1, 0], clamp);
  return (
    <div className="empty-queue" style={{opacity: out, transform: `translateY(${interpolate(out, [0, 1], [16, 0])}px)`}}>
      <div className="empty-icon"><ListVideo size={42} /></div>
      <strong>Your queue is quiet</strong>
      <span>Paste a link above. We’ll take care of the rest.</span>
    </div>
  );
};

const QueueCard: React.FC<{frame: number; delay: number; title: string; meta: string; color: string; progress?: number}> = ({frame, delay, title, meta, color, progress = 1}) => {
  const {fps} = useVideoConfig();
  const enter = spring({frame: frame - delay, fps, config: {damping: 18, stiffness: 130, mass: 0.75}});
  const fill = interpolate(frame, [delay + 12, delay + 88], [0, progress], clamp);
  const done = fill > 0.98;
  return (
    <div className="queue-card" style={{opacity: enter, transform: `translateY(${interpolate(enter, [0, 1], [42, 0])}px) scale(${interpolate(enter, [0, 1], [0.96, 1])})`}}>
      <div className="thumb" style={{background: color}}><div className="thumb-play">▶</div></div>
      <div className="card-copy"><strong>{title}</strong><span>{meta}</span><div className="progress"><i style={{width: `${fill * 100}%`}} /></div></div>
      <div className={`status ${done ? 'done' : ''}`}>{done ? <Check size={19} /> : <Download size={19} />}</div>
    </div>
  );
};

const AppWindow: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame: frame - 65, fps, config: {damping: 20, stiffness: 80, mass: 0.9}});
  const scale = interpolate(enter, [0, 1], [0.78, 1]);
  const camera = interpolate(frame, [84, 430], [1, 1.035], {...clamp, easing: Easing.inOut(Easing.quad)});
  const featureFocus = interpolate(frame, [374, 405, 478, 498], [1, 0.27, 0.27, 1], clamp);
  const featureScale = interpolate(frame, [374, 405, 478, 498], [1, 0.94, 0.94, 1], clamp);
  const windowOut = interpolate(frame, [494, 526], [1, 0], clamp);
  return (
    <div className="window-wrap" style={{opacity: enter * windowOut * featureFocus, transform: `translateY(${interpolate(enter, [0, 1], [130, 0])}px) scale(${scale * camera * featureScale})`}}>
      <div className="app-window">
        <div className="glass-shine" />
        <AppChrome />
        <main className="app-content">
          <div className="eyebrow"><Sparkles size={16} /> YOUR VIDEOS, BEAUTIFULLY OFFLINE</div>
          <h2>Save what you love.</h2>
          <p>Videos, playlists, and audio. Fast, private, and yours.</p>
          <InputMoment frame={frame} />
          <div className="queue-heading"><strong>Queue</strong><span>{frame < 218 ? 'Ready when you are.' : 'Downloading beautifully.'}</span></div>
          <div className="queue-rule" />
          <EmptyQueue frame={frame} />
          <div className="cards">
            <QueueCard frame={frame} delay={220} title="A day in Copenhagen" meta="4K · Ultra HD" color="linear-gradient(135deg,#7198a8,#d3c7b8)" />
            <QueueCard frame={frame} delay={248} title="Designing with light" meta="1080p · 12:48" color="linear-gradient(135deg,#213b4e,#88b4bc)" />
            <QueueCard frame={frame} delay={276} title="Sunday morning mix" meta="Audio · M4A" color="linear-gradient(135deg,#b4a084,#557887)" />
          </div>
        </main>
      </div>
    </div>
  );
};

const FeatureWords: React.FC = () => {
  const frame = useCurrentFrame();
  const local = frame - 370;
  const words = [
    {at: 0, label: 'Fast.', icon: <Download />},
    {at: 42, label: 'Private.', icon: <Folder />},
    {at: 84, label: 'Yours.', icon: <Check />},
  ];
  return (
    <div className="feature-words" style={{opacity: fade(frame, 365, 500)}}>
      {words.map((word) => {
        const value = spring({frame: local - word.at, fps: 30, config: {damping: 16, stiffness: 120}});
        return <div key={word.label} style={{opacity: value, transform: `translateY(${interpolate(value, [0, 1], [36, 0])}px)`}}><span>{word.icon}</span>{word.label}</div>;
      })}
    </div>
  );
};

const Closing: React.FC = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const enter = spring({frame: frame - 510, fps, config: {damping: 18, stiffness: 85}});
  const glow = interpolate(frame, [510, 599], [0.65, 1]);
  return (
    <AbsoluteFill className="closing" style={{opacity: enter}}>
      <div className="closing-halo" style={{opacity: glow, transform: `scale(${interpolate(glow, [0.65, 1], [0.8, 1.15])})`}} />
      <div className="closing-lockup" style={{transform: `translateY(${interpolate(enter, [0, 1], [30, 0])}px)`}}>
        <Logo size={112} light />
        <h2>Save what you love.</h2>
        <p>MacTube for macOS</p>
        <div className="closing-chip"><Download size={18} /> Download beautifully.</div>
      </div>
    </AbsoluteFill>
  );
};

export const MacTubeLaunch: React.FC = () => {
  return (
    <AbsoluteFill className="film">
      <Audio src={staticFile('trailer-score.wav')} volume={0.78} />
      <Desktop />
      <Opening />
      <AppWindow />
      <FeatureWords />
      <Closing />
      <div className="vignette" />
    </AbsoluteFill>
  );
};
