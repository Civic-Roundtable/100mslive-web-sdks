import { useEffect, useRef } from 'react';
import {
  HMSMediaStreamPlugin,
  selectAppData,
  selectEffectsKey,
  selectIsEffectsEnabled,
  selectLocalPeerRole,
  selectLocalVideoTrackID,
} from '@100mslive/hms-video-store';
// eslint-disable-next-line
import { HMSVBPlugin, HMSVirtualBackgroundTypes } from '@100mslive/hms-virtual-background/hmsvbplugin';
import {
  selectIsLocalVideoEnabled,
  selectIsLocalVideoPluginPresent,
  useHMSActions,
  useHMSStore,
} from '@100mslive/react-sdk';
import { VBHandler } from './VBHandler';
import { APP_DATA } from '../../common/constants';

export const VBAutoLoader = () => {
  const hmsActions = useHMSActions();
  const role = useHMSStore(selectLocalPeerRole);
  const isVideoOn = useHMSStore(selectIsLocalVideoEnabled);
  const trackId = useHMSStore(selectLocalVideoTrackID);
  const isEffectsEnabled = useHMSStore(selectIsEffectsEnabled);
  const effectsKey = useHMSStore(selectEffectsKey);
  const isPluginAdded = useHMSStore(selectIsLocalVideoPluginPresent(VBHandler?.getName() || ''));
  const background = useHMSStore(selectAppData(APP_DATA.background));
  const pluginInitialized = useRef(false);
  const isEffectsSupported = VBHandler.isEffectsSupported();

  useEffect(() => {
    // Only proceed if video is on and the plugin isn't already added
    if (!trackId || !isVideoOn || isPluginAdded || pluginInitialized.current) {
      return;
    }

    const applySavedBackground = async () => {
      try {
        pluginInitialized.current = true;

        // Initialize the VB plugin
        if (isEffectsEnabled && isEffectsSupported && effectsKey) {
          await VBHandler.initialisePlugin(effectsKey);
          const vbInstance = VBHandler.getVBObject();
          if (vbInstance && vbInstance.getName() === 'HMSEffects') {
            await hmsActions.addPluginsToVideoStream([vbInstance as HMSMediaStreamPlugin]);
          } else {
            await addHMSVBPlugin();
          }
        } else {
          await addHMSVBPlugin();
        }

        // First check if there's a current background in app data
        if (background && background !== HMSVirtualBackgroundTypes.NONE) {
          // Background is already set in app data, no need to change it
          return;
        }

        // Otherwise, attempt to load from localStorage
        const savedSettings = VBHandler.loadBackgroundSettings();
        if (savedSettings && savedSettings.backgroundValue !== HMSVirtualBackgroundTypes.NONE) {
          switch (savedSettings.backgroundType) {
            case 'blur':
              await VBHandler.setBlur(savedSettings.blurAmount);
              // Update app data to reflect the loaded setting
              hmsActions.setAppData(APP_DATA.background, HMSVirtualBackgroundTypes.BLUR);
              break;
            case 'image':
              await VBHandler.setBackground(savedSettings.backgroundValue);
              // Update app data to reflect the loaded setting
              hmsActions.setAppData(APP_DATA.background, savedSettings.backgroundValue);
              break;
            default:
              break;
          }
        }
      } catch (error) {
        console.error('Failed to auto-load virtual background settings:', error);
        pluginInitialized.current = false;
      }
    };

    const addHMSVBPlugin = async () => {
      if (!role) {
        return;
      }
      await VBHandler.initialisePlugin();
      await hmsActions.addPluginToVideoTrack(
        VBHandler.getVBObject() as HMSVBPlugin,
        Math.floor(role.publishParams.video.frameRate / 2),
      );
    };

    applySavedBackground();
  }, [
    trackId,
    isVideoOn,
    isPluginAdded,
    isEffectsEnabled,
    isEffectsSupported,
    effectsKey,
    role,
    hmsActions,
    background,
  ]);

  return null;
};
