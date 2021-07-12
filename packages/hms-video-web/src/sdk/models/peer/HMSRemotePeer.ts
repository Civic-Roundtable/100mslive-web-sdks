import { HMSPeer, HMSPeerInit } from './HMSPeer';
import { HMSRemoteTrack } from '../../../media/streams/HMSRemoteStream';
import { HMSRemoteAudioTrack, HMSRemoteVideoTrack } from '../../../media/tracks';

type HMSRemotePeerInit = Omit<HMSPeerInit, 'isLocal'>;

export class HMSRemotePeer extends HMSPeer {
  isLocal: boolean = false;
  audioTrack?: HMSRemoteAudioTrack;
  videoTrack?: HMSRemoteVideoTrack;
  auxiliaryTracks: HMSRemoteTrack[] = [];

  constructor({ peerId, name, role, customerUserId, customerDescription }: HMSRemotePeerInit) {
    super({ isLocal: false, peerId, name, role, customerUserId, customerDescription });
  }
}
