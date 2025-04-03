import { useEffect, useRef } from 'react';
import {
  HMSMediaStreamPlugin,
  selectEffectsKey,
  selectIsEffectsEnabled,
  selectLocalPeerRole,
} from '@100mslive/hms-video-store';
// Open issue with eslint-plugin-import https://github.com/import-js/eslint-plugin-import/issues/1810
// eslint-disable-next-line
import { HMSVBPlugin, HMSVirtualBackgroundTypes } from '@100mslive/hms-virtual-background/hmsvbplugin';
import {
  selectIsLocalVideoPluginPresent,
  selectLocalPeer,
  selectVideoTrackByID,
  useHMSActions,
  useHMSStore,
} from '@100mslive/react-sdk';
import { VBHandler } from './VBHandler';
// @ts-ignore: No implicit Any
import { useSetAppDataByKey } from '../AppData/useUISettings';
import { useBackground } from './use-background';
import { APP_DATA } from '../../common/constants';

export function useInitializeBackground(initialize = true) {
  const hmsActions = useHMSActions();
  const localPeer = useHMSStore(selectLocalPeer);
  const role = useHMSStore(selectLocalPeerRole);
  const trackSelector = selectVideoTrackByID(localPeer?.videoTrack);
  const track = useHMSStore(trackSelector);
  const isEffectsSupported = VBHandler.isEffectsSupported();
  const isEffectsEnabled = useHMSStore(selectIsEffectsEnabled);
  const effectsKey = useHMSStore(selectEffectsKey);
  const [loadingEffects, setLoadingEffects] = useSetAppDataByKey(APP_DATA.loadingEffects);
  const isPluginAdded = useHMSStore(selectIsLocalVideoPluginPresent(VBHandler?.getName() || ''));
  const [background, setBackground] = useBackground();
  const pluginLoadingRef = useRef(false);

  useEffect(() => {
    const addHMSVBPlugin = async () => {
      setLoadingEffects(false);
      if (!role) {
        return;
      }
      await VBHandler.initialisePlugin();
      await hmsActions.addPluginToVideoTrack(
        VBHandler.getVBObject() as HMSVBPlugin,
        Math.floor(role.publishParams.video.frameRate / 2),
      );
    };
    const initializeVirtualBackground = async () => {
      if (!track?.id || pluginLoadingRef.current || isPluginAdded || !initialize) {
        return;
      }

      try {
        pluginLoadingRef.current = true;
        if (isEffectsEnabled && isEffectsSupported && effectsKey) {
          setLoadingEffects(true);
          await VBHandler.initialisePlugin(effectsKey, () => {
            setLoadingEffects(false);
          });
          const vbInstance = VBHandler.getVBObject();
          if (vbInstance.getName() === 'HMSEffects') {
            hmsActions.addPluginsToVideoStream([VBHandler.getVBObject() as HMSMediaStreamPlugin]);
          } else {
            await addHMSVBPlugin();
          }
        } else {
          await addHMSVBPlugin();
        }

        const handleDefaultBackground = async () => {
          switch (background.type) {
            case HMSVirtualBackgroundTypes.NONE:
              break;
            case HMSVirtualBackgroundTypes.BLUR:
              await VBHandler.setBlur(background.blurAmount);
              break;
            default:
              await VBHandler.setBackground(background.mediaURL);
          }
        };

        await handleDefaultBackground();
      } catch (error) {
        console.error('Error initializing virtual background:', error);
        setLoadingEffects(false);
      }
    };

    initializeVirtualBackground();
  }, [
    hmsActions,
    role,
    isPluginAdded,
    isEffectsEnabled,
    isEffectsSupported,
    effectsKey,
    track?.id,
    background,
    setLoadingEffects,
    initialize,
  ]);

  return { loadingEffects, setLoadingEffects, background, setBackground };
}
