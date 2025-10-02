// src/components/Hamster.tsx

'use client';

import Image from 'next/image';

type HamsterProps = {
  gif: 'dancing' | 'wiggling' | 'spinning' | 'head';
  size?: number;
  className?: string;
};

const gifMap = {
  dancing: '/hamster-dancing.gif',
  wiggling: '/hamster-wiggling.gif',
  spinning: '/hamster-spinning.gif',
  head: '/hamster-head.gif',
};

const Hamster: React.FC<HamsterProps> = ({
  gif = 'dancing',
  size = 64,
  className = '',
}) => {
  return (
    <Image
      src={gifMap[gif]}
      alt="Dancing hamster"
      width={size}
      height={size}
      unoptimized // Important for GIFs to prevent them from becoming static images
      className={className}
    />
  );
};

export default Hamster;