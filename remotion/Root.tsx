import React from 'react';
import {Composition} from 'remotion';
import {MacTubeLaunch} from './MacTubeLaunch';

export const RemotionRoot: React.FC = () => (
  <Composition
    id="MacTubeLaunch"
    component={MacTubeLaunch}
    durationInFrames={600}
    fps={30}
    width={1920}
    height={1080}
  />
);
