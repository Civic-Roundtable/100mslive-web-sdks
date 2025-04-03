// Open issue with eslint-plugin-import https://github.com/import-js/eslint-plugin-import/issues/1810
// eslint-disable-next-line
import { HMSVirtualBackgroundTypes } from '@100mslive/hms-virtual-background/hmsvbplugin';
import { BlurPersonHighIcon, CrossCircleIcon, CrossIcon } from '@100mslive/react-icons';
import {
  HMSRoomState,
  selectIsLargeRoom,
  selectIsLocalVideoEnabled,
  selectLocalPeer,
  selectRoomState,
  selectVideoTrackByID,
  useHMSStore,
} from '@100mslive/react-sdk';
import { VirtualBackgroundMedia } from '@100mslive/types-prebuilt/elements/virtual_background';
import React, { useEffect } from 'react';
import { useMedia } from 'react-use';
import { Box, config as cssConfig, Flex, Loading, Slider, Video } from '../../../index';
import { Text } from '../../../Text';
import { SIDE_PANE_OPTIONS, UI_SETTINGS } from '../../common/constants';
// @ts-ignore
import { useSidepaneToggle } from '../AppData/useSidepane';
import { useSidepaneResetOnLayoutUpdate } from '../AppData/useSidepaneResetOnLayoutUpdate';
// @ts-ignore
import { useUISettings } from '../AppData/useUISettings';
import { useInitializeBackground } from './use-inintialize-background';
import { VBCollection } from './VBCollection';
import { VBHandler } from './VBHandler';

const iconDims = { height: '40px', width: '40px' };

export const VBPicker = ({ backgroundMedia = [] }: { backgroundMedia: VirtualBackgroundMedia[] }) => {
  const toggleVB = useSidepaneToggle(SIDE_PANE_OPTIONS.VB);
  const localPeer = useHMSStore(selectLocalPeer);
  const isVideoOn = useHMSStore(selectIsLocalVideoEnabled);
  const mirrorLocalVideo = useUISettings(UI_SETTINGS.mirrorLocalVideo);
  const trackSelector = selectVideoTrackByID(localPeer?.videoTrack);
  const track = useHMSStore(trackSelector);
  const roomState = useHMSStore(selectRoomState);
  const isLargeRoom = useHMSStore(selectIsLargeRoom);
  const isMobile = useMedia(cssConfig.media.md);
  const mediaList = backgroundMedia.map((media: VirtualBackgroundMedia) => media.url || '');
  const isBlurSupported = VBHandler?.isBlurSupported();

  const inPreview = roomState === HMSRoomState.Preview;
  // Hidden in preview as the effect will be visible in the preview tile
  const showVideoTile = isVideoOn && isLargeRoom && !inPreview;

  const { loadingEffects, setLoadingEffects, background, setBackground } = useInitializeBackground();

  useEffect(() => {
    if (!isVideoOn) {
      toggleVB();
    }
    return () => setLoadingEffects(false);
  }, [isVideoOn, setLoadingEffects, toggleVB]);

  useSidepaneResetOnLayoutUpdate('virtual_background', SIDE_PANE_OPTIONS.VB);

  return (
    <Flex css={{ pr: '$6', size: '100%' }} direction="column">
      <Flex align="center" justify="between" css={{ w: '100%', background: '$surface_dim', pb: '$4' }}>
        <Text variant="h6" css={{ color: '$on_surface_high', display: 'flex', alignItems: 'center' }}>
          Virtual Background {isMobile && loadingEffects ? <Loading size={18} style={{ marginLeft: '0.5rem' }} /> : ''}
        </Text>
        <Box
          css={{ color: '$on_surface_high', '&:hover': { color: '$on_surface_medium' }, cursor: 'pointer' }}
          onClick={toggleVB}
        >
          <CrossIcon />
        </Box>
      </Flex>

      {showVideoTile ? (
        <Video
          mirror={track?.facingMode !== 'environment' && mirrorLocalVideo}
          trackId={localPeer?.videoTrack}
          data-testid="preview_tile"
          css={{ width: '100%', height: '16rem' }}
        />
      ) : null}
      <Box
        css={{
          mt: '$4',
          overflowY: 'auto',
          flex: '1 1 0',
          mr: '-$10',
          pr: '$10',
        }}
      >
        <VBCollection
          title="Effects"
          options={[
            {
              title: 'No effect',
              icon: <CrossCircleIcon style={iconDims} />,
              value: HMSVirtualBackgroundTypes.NONE,
              onClick: async () => {
                await VBHandler.removeEffects();
                setBackground({ type: HMSVirtualBackgroundTypes.NONE });
                if (isMobile) {
                  toggleVB();
                }
              },
              supported: true,
            },
            {
              title: 'Blur',
              icon: <BlurPersonHighIcon style={iconDims} />,
              value: HMSVirtualBackgroundTypes.BLUR,
              onClick: async () => {
                const blurAmount = VBHandler.getBlurAmount() || 0.5;
                await VBHandler?.setBlur(blurAmount);
                setBackground({ type: HMSVirtualBackgroundTypes.BLUR, blurAmount });
              },
              supported: isBlurSupported,
            },
          ]}
          activeBackground={background.type}
        />

        {/* Slider */}
        <Flex direction="column" css={{ w: '100%', gap: '$8', mt: '$8' }}>
          {background.type === HMSVirtualBackgroundTypes.BLUR && isBlurSupported ? (
            <Box>
              <Text variant="sm" css={{ color: '$on_surface_high', fontWeight: '$semiBold', mb: '$4' }}>
                Blur intensity
              </Text>
              <Flex css={{ w: '100%', justifyContent: 'space-between', alignItems: 'center', gap: '$4' }}>
                <Text variant="caption" css={{ fontWeight: '$medium', color: '$on_surface_medium' }}>
                  Low
                </Text>
                <Slider
                  showTooltip={false}
                  value={[background.blurAmount]}
                  onValueChange={async e => {
                    setBackground({ type: HMSVirtualBackgroundTypes.BLUR, blurAmount: e[0] });
                    await VBHandler.setBlur(e[0]);
                  }}
                  step={0.1}
                  min={0.1}
                  max={1}
                />
                <Text variant="caption" css={{ fontWeight: '$medium', color: '$on_surface_medium' }}>
                  High
                </Text>
              </Flex>
            </Box>
          ) : null}
        </Flex>

        <VBCollection
          title="Backgrounds"
          options={mediaList.map(mediaURL => ({
            mediaURL,
            value: mediaURL,
            onClick: async () => {
              await VBHandler?.setBackground(mediaURL);
              setBackground({ type: HMSVirtualBackgroundTypes.IMAGE, mediaURL });
              if (isMobile) {
                toggleVB();
              }
            },
            supported: true,
          }))}
          activeBackground={background.type === HMSVirtualBackgroundTypes.IMAGE ? background.mediaURL : ''}
        />
      </Box>
    </Flex>
  );
};
