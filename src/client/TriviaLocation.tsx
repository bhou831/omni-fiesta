import { useEffect, useRef, useState } from 'react';

export type TriviaLocationView = {
  panoId: string;
  heading: number;
  pitch: number;
  zoom: number;
};
type MapsWindow = Window & {
  google?: {
    maps: {
      StreetViewPanorama: new (element: HTMLElement, options: Record<string, unknown>) => unknown;
    };
  };
  __triviaMapsReady?: () => void;
  __triviaMapsLoad?: Promise<
    new (element: HTMLElement, options: Record<string, unknown>) => unknown
  >;
};

function loadMaps(
  key: string,
): Promise<new (element: HTMLElement, options: Record<string, unknown>) => unknown> {
  const host = window as MapsWindow;
  if (host.__triviaMapsLoad) return host.__triviaMapsLoad;
  const loading = (async () => {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      const callback = '__triviaMapsReady';
      host[callback] = resolve;
      const params = new URLSearchParams({
        key,
        callback,
        v: 'weekly',
      });
      script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
      script.async = true;
      script.onerror = () => {
        delete host[callback];
        reject(new Error('Google 地图加载失败，请检查网络和地图密钥设置。'));
      };
      document.head.append(script);
    });
    delete host.__triviaMapsReady;
    const StreetViewPanorama = host.google?.maps.StreetViewPanorama;
    if (!StreetViewPanorama) throw new Error('Google 地图组件未能加载。');
    return StreetViewPanorama;
  })().catch((error: unknown) => {
    host.__triviaMapsLoad = undefined;
    throw error;
  });
  host.__triviaMapsLoad = loading;
  return loading;
}

export function TriviaLocation({ scene }: { scene: TriviaLocationView }) {
  const mapElement = useRef<HTMLDivElement>(null);
  const [mapError, setMapError] = useState('');
  useEffect(() => {
    let cancelled = false;
    const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!key || !mapElement.current) {
      setMapError('大屏幕尚未配置地图密钥。');
      return;
    }
    loadMaps(key)
      .then((StreetViewPanorama) => {
        if (cancelled || !mapElement.current) return;
        new StreetViewPanorama(mapElement.current, {
          pano: scene.panoId,
          pov: { heading: scene.heading, pitch: scene.pitch },
          zoom: scene.zoom,
          addressControl: false,
          showRoadLabels: false,
          linksControl: false,
          panControl: true,
          zoomControl: true,
          fullscreenControl: false,
          motionTracking: false,
          visible: true,
        });
      })
      .catch((error: unknown) => {
        if (!cancelled) setMapError(error instanceof Error ? error.message : '地图加载失败。');
      });
    return () => {
      cancelled = true;
    };
  }, [scene.panoId, scene.heading, scene.pitch, scene.zoom]);
  return (
    <section className="trivia-location" aria-label="地理位置挑战">
      <div ref={mapElement} className="trivia-location-map" aria-label="可旋转和缩放的街景地图" />
      {mapError && (
        <p className="trivia-location-message" role="status">
          {mapError}
        </p>
      )}
      <p className="trivia-location-message">抢答成功后请口头回答，由主持人判断。</p>
      <small className="trivia-location-attribution">街景由 Google 提供</small>
    </section>
  );
}
