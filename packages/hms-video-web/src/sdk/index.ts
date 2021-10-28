import { HMSConfig, HMSVideoCodec, HMSMessageInput, HMSDeviceChangeEvent } from '../interfaces';
import InitialSettings from '../interfaces/settings';
import HMSInterface from '../interfaces/hms';
import HMSTransport from '../transport';
import ITransportObserver from '../transport/ITransportObserver';
import { HMSAudioListener, HMSTrackUpdate, HMSUpdateListener } from '../interfaces/update-listener';
import HMSLogger, { HMSLogLevel } from '../utils/logger';
import decodeJWT from '../utils/jwt';
import { NotificationManager, HMSNotificationMethod, PeerLeaveRequestNotification } from '../notification-manager';
import {
  HMSTrackSource,
  HMSTrackType,
  HMSLocalAudioTrack,
  HMSLocalVideoTrack,
  HMSRemoteVideoTrack,
  HMSLocalTrack,
  HMSRemoteTrack,
} from '../media/tracks';
import { HMSException } from '../error/HMSException';
import HMSRoom from './models/HMSRoom';
import { HMSLocalPeer, HMSPeer, HMSRemotePeer } from './models/peer';
import Message from './models/HMSMessage';
import HMSLocalStream from '../media/streams/HMSLocalStream';
import { HMSVideoTrackSettingsBuilder, HMSAudioTrackSettingsBuilder } from '../media/settings';
import { AudioSinkManager } from '../audio-sink-manager';
import { DeviceManager, AudioOutputManager } from '../device-manager';
import { HMSAnalyticsLevel } from '../analytics/AnalyticsEventLevel';
import analyticsEventsService from '../analytics/AnalyticsEventsService';
import { TransportState } from '../transport/models/TransportState';
import { ErrorFactory, HMSAction } from '../error/ErrorFactory';
import { ErrorCodes } from '../error/ErrorCodes';
import { HMSPreviewListener } from '../interfaces/preview-listener';
import { IErrorListener } from '../interfaces/error-listener';
import { IStore, Store } from './store';
import { DeviceChangeListener } from '../interfaces/device-change-listener';
import { HMSRoleChangeRequest, HMSRole, HMSChangeMultiTrackStateParams } from '../interfaces';
import RoleChangeManager from './RoleChangeManager';
import { AutoplayError, AutoplayEvent } from '../audio-sink-manager/AudioSinkManager';
import { HMSLeaveRoomRequest } from '../interfaces/leave-room-request';
import { DeviceStorageManager } from '../device-manager/DeviceStorage';
import { LocalTrackManager } from './LocalTrackManager';
import { PlaylistManager } from '../playlist-manager';
import { RTMPRecordingConfig } from '../interfaces/rtmp-recording-config';
import { isNode } from '../utils/support';

// @DISCUSS: Adding it here as a hotfix
const defaultSettings = {
  isAudioMuted: false,
  isVideoMuted: false,
  audioInputDeviceId: 'default',
  audioOutputDeviceId: 'default',
  videoDeviceId: 'default',
};

const INITIAL_STATE = {
  published: false,
  isInitialised: false,
  isReconnecting: false,
  isPreviewInProgress: false,
  deviceManagersInitialised: false,
};

export class HMSSdk implements HMSInterface {
  private transport!: HMSTransport;
  private TAG: string = '[HMSSdk]:';
  private listener?: HMSUpdateListener;
  private errorListener?: IErrorListener;
  private deviceChangeListener?: DeviceChangeListener;
  private audioListener?: HMSAudioListener;
  private store!: IStore;
  private notificationManager!: NotificationManager;
  private deviceManager!: DeviceManager;
  private audioSinkManager!: AudioSinkManager;
  private playlistManager!: PlaylistManager;
  private audioOutput!: AudioOutputManager;
  private transportState: TransportState = TransportState.Disconnected;
  private roleChangeManager?: RoleChangeManager;
  private localTrackManager!: LocalTrackManager;
  private sdkState = { ...INITIAL_STATE };

  private initStoreAndManagers() {
    if (this.sdkState.isInitialised) {
      /**
       * Set listener after both join and preview, since they can have different listeners
       */
      this.notificationManager.setListener(this.listener);
      this.audioSinkManager.setListener(this.listener);
      return;
    }

    this.sdkState.isInitialised = true;
    this.store = new Store();
    this.playlistManager = new PlaylistManager(this);
    this.notificationManager = new NotificationManager(this.store, this.listener, this.audioListener);
    this.deviceManager = new DeviceManager(this.store);
    this.audioSinkManager = new AudioSinkManager(this.store, this.notificationManager, this.deviceManager);
    this.audioOutput = new AudioOutputManager(this.deviceManager, this.audioSinkManager);
    this.audioSinkManager.addEventListener(AutoplayError, this.handleAutoplayError);
    this.transport = new HMSTransport(this.observer, this.deviceManager, this.store);
    this.localTrackManager = new LocalTrackManager(this.store, this.observer, this.deviceManager);
  }

  getPlaylistManager(): PlaylistManager {
    return this.playlistManager;
  }

  getRecordingState() {
    return this.store.getRoom()?.recording;
  }

  getRTMPState() {
    return this.store.getRoom()?.rtmp;
  }

  private handleAutoplayError = (event: AutoplayEvent) => {
    this.errorListener?.onError?.(event.error);
  };

  private get localPeer(): HMSLocalPeer | undefined {
    return this.store?.getLocalPeer();
  }

  private observer: ITransportObserver = {
    onNotification: (message: any) => {
      if (message.method === HMSNotificationMethod.PEER_LEAVE_REQUEST) {
        this.handlePeerLeaveRequest(message.params as PeerLeaveRequestNotification);
        return;
      }
      this.notificationManager.handleNotification(message, this.sdkState.isReconnecting);
    },

    onTrackAdd: (track: HMSRemoteTrack) => {
      this.notificationManager.handleTrackAdd(track);
    },

    onTrackRemove: (track: HMSRemoteTrack) => {
      this.notificationManager.handleTrackRemove(track);
    },

    onTrackDegrade: (track: HMSRemoteVideoTrack) => {
      HMSLogger.d(this.TAG, 'Sending Track Update Track Degraded', track);
      this.listener?.onTrackUpdate(HMSTrackUpdate.TRACK_DEGRADED, track, this.store?.getPeerByTrackId(track.trackId)!);
    },

    onTrackRestore: (track: HMSRemoteVideoTrack) => {
      HMSLogger.d(this.TAG, 'Sending Track Update Track Restored', track);
      this.listener?.onTrackUpdate(HMSTrackUpdate.TRACK_RESTORED, track, this.store?.getPeerByTrackId(track.trackId)!);
    },

    onFailure: (exception: HMSException) => {
      this.errorListener?.onError(exception);
    },

    onStateChange: async (state: TransportState, error?: HMSException) => {
      switch (state) {
        case TransportState.Joined:
          if (this.transportState === TransportState.Reconnecting) {
            this.listener?.onReconnected();
          }
          break;
        case TransportState.Failed:
          await this.leave();

          this.errorListener?.onError?.(error!);
          this.sdkState.isReconnecting = false;
          break;
        case TransportState.Reconnecting:
          this.sdkState.isReconnecting = true;
          this.listener?.onReconnecting(error!);
          break;
      }

      this.transportState = state;
    },
  };

  private handlePeerLeaveRequest = (message: PeerLeaveRequestNotification) => {
    const peer = this.store.getPeerById(message.requested_by);
    const request: HMSLeaveRoomRequest = {
      roomEnded: message.room_end,
      reason: message.reason,
      requestedBy: peer!,
    };
    this.listener?.onRemovedFromRoom(request);
    this.leave();
  };

  async preview(config: HMSConfig, listener: HMSPreviewListener) {
    if (this.sdkState.isPreviewInProgress) {
      return;
    }
    this.sdkState.isPreviewInProgress = true;
    const { roomId, userId, role } = decodeJWT(config.authToken);
    this.errorListener = listener;
    this.deviceChangeListener = listener;
    this.initStoreAndManagers();

    this.store.setErrorListener(this.errorListener);
    this.store.setConfig(config);
    this.store.setRoom(new HMSRoom(roomId, config.userName, this.store));
    const policy = this.store.getPolicyForRole(role);
    const localPeer = new HMSLocalPeer({
      name: config.userName || '',
      customerUserId: userId,
      customerDescription: config.metaData,
      role: policy,
    });

    this.store.addPeer(localPeer);
    HMSLogger.d(this.TAG, 'SDK Store', this.store);

    const policyHandler = async () => {
      this.notificationManager.removeEventListener('policy-change', policyHandler);
      const tracks = await this.localTrackManager.getTracksToPublish(config.settings || defaultSettings);
      tracks.forEach((track) => this.setLocalPeerTrack(track));
      this.localPeer?.audioTrack && this.initPreviewTrackAudioLevelMonitor();
      await this.initDeviceManagers();
      listener.onPreview(this.store.getRoom(), tracks);
      this.sdkState.isPreviewInProgress = false;
    };

    this.notificationManager.addEventListener('policy-change', policyHandler);

    try {
      await this.transport.connect(
        config.authToken,
        config.initEndpoint || 'https://prod-init.100ms.live/init',
        this.localPeer!.peerId,
      );
    } catch (ex) {
      this.errorListener?.onError(ex as HMSException);
      this.sdkState.isPreviewInProgress = false;
    }
  }

  private handleDeviceChangeError = (event: HMSDeviceChangeEvent) => {
    HMSLogger.d(this.TAG, 'Device Change event', event);
    this.deviceChangeListener?.onDeviceChange?.(event);
    if (event.error && event.type) {
      const track = event.type.includes('audio') ? this.localPeer?.audioTrack : this.localPeer?.videoTrack;
      this.errorListener?.onError(event.error);
      if (
        [
          ErrorCodes.TracksErrors.CANT_ACCESS_CAPTURE_DEVICE,
          ErrorCodes.TracksErrors.DEVICE_IN_USE,
          ErrorCodes.TracksErrors.DEVICE_NOT_AVAILABLE,
        ].includes(event.error.code) &&
        track
      ) {
        track.setEnabled(false);
        this.listener?.onTrackUpdate(HMSTrackUpdate.TRACK_MUTED, track, this.localPeer!);
      }
    }
  };

  join(config: HMSConfig, listener: HMSUpdateListener) {
    if (this.sdkState.isPreviewInProgress) {
      throw ErrorFactory.GenericErrors.NotReady(HMSAction.JOIN, "Preview is in progress, can't join");
    }

    this.localPeer?.audioTrack?.destroyAudioLevelMonitor();
    this.listener = listener;
    this.errorListener = listener;
    this.deviceChangeListener = listener;
    this.initStoreAndManagers();

    const storedConfig = this.store.getConfig();

    if (storedConfig && config.settings) {
      // preview was called
      delete config.settings.audioOutputDeviceId;
      delete config.settings.videoDeviceId;
      delete config.settings.audioInputDeviceId;
    }

    this.store.setErrorListener(this.errorListener);
    this.store.setConfig(config);
    const { roomId, userId, role } = decodeJWT(config.authToken);

    if (!this.localPeer) {
      this.notificationManager.addEventListener('role-change', (e: any) => {
        this.store.setPublishParams(e.detail.params.role.publishParams);
      });

      const localPeer = new HMSLocalPeer({
        name: config.userName,
        customerUserId: userId,
        customerDescription: config.metaData || '',
        role: this.store.getPolicyForRole(role),
      });
      this.store.addPeer(localPeer);
    } else {
      this.localPeer.name = config.userName;
      this.localPeer.role = this.store.getPolicyForRole(role);
      this.localPeer.customerUserId = userId;
      this.localPeer.customerDescription = config.metaData || '';
    }

    this.roleChangeManager = new RoleChangeManager(
      this.store,
      this.transport,
      this.publish.bind(this),
      this.removeTrack.bind(this),
      this.listener,
    );
    this.notificationManager.addEventListener(
      'local-peer-role-update',
      this.roleChangeManager.handleLocalPeerRoleUpdate,
    );

    HMSLogger.d(this.TAG, 'SDK Store', this.store);
    HMSLogger.d(this.TAG, `⏳ Joining room ${roomId}`);

    if (!this.store.getRoom()) {
      // note: store room is used to handle server notifications in join and has to be done before join process starts
      this.store.setRoom(new HMSRoom(roomId, config.userName, this.store));
    }
    HMSLogger.time(`join-room-${roomId}`);
    this.transport
      .join(
        config.authToken,
        this.localPeer!.peerId,
        { name: config.userName, metaData: config.metaData || '' },
        config.initEndpoint,
        config.autoVideoSubscribe,
      )
      .then(async () => {
        HMSLogger.d(this.TAG, `✅ Joined room ${roomId}`);
        // if delay fix is set, call onJoin before publishing
        //@ts-ignore
        if (window.HMS?.JOIN_DELAY_FIX) {
          this.notifyJoin();
        }
        if (this.publishParams && !this.sdkState.published && !isNode) {
          await this.publish(config.settings || defaultSettings);
        }
        //@ts-ignore
        if (!window.HMS?.JOIN_DELAY_FIX) {
          this.notifyJoin();
        }
      })
      .catch((error) => {
        this.listener?.onError(error as HMSException);
        HMSLogger.e(this.TAG, 'Unable to join room', error);
      })
      .then(() => {
        HMSLogger.timeEnd(`join-room-${roomId}`);
      });
  }

  private cleanUp() {
    this.store.cleanUp();
    this.cleanDeviceManagers();
    DeviceStorageManager.cleanup();
    this.playlistManager.cleanup();
    HMSLogger.cleanUp();
    this.sdkState = { ...INITIAL_STATE };
    /**
     * when leave is called after preview itself without join.
     * Store won't have the tracks in this case
     */
    if (this.localPeer) {
      this.localPeer.audioTrack?.cleanup();
      this.localPeer.audioTrack = undefined;
      this.localPeer.videoTrack?.cleanup();
      this.localPeer.videoTrack = undefined;
    }
    this.listener = undefined;
    if (this.roleChangeManager) {
      this.notificationManager.removeEventListener(
        'local-peer-role-update',
        this.roleChangeManager.handleLocalPeerRoleUpdate,
      );
    }
  }

  async leave() {
    const room = this.store.getRoom();
    if (room) {
      const roomId = room.id;
      HMSLogger.d(this.TAG, `⏳ Leaving room ${roomId}`);
      // browsers often put limitation on amount of time a function set on window onBeforeUnload can take in case of
      // tab refresh or close. Therefore prioritise the leave action over anything else, if tab is closed/refreshed
      // we would want leave to succeed to stop stucked peer for others. The followup cleanup however is important
      // for cases where uses stays on the page post leave.
      await this.transport?.leave();
      this.cleanUp();
      HMSLogger.d(this.TAG, `✅ Left room ${roomId}`);
    }
  }

  getLocalPeer() {
    return this.store.getLocalPeer();
  }

  getPeers() {
    const peers = this.store.getPeers();
    HMSLogger.d(this.TAG, `Got peers`, peers);
    return peers;
  }

  getAudioOutput() {
    return this.audioOutput;
  }

  sendMessage(type: string, message: string) {
    this.sendMessageInternal({ message, type });
  }

  async sendBroadcastMessage(message: string, type?: string) {
    return await this.sendMessageInternal({ message, type });
  }

  async sendGroupMessage(message: string, roles: HMSRole[], type?: string) {
    const knownRoles = this.store.getKnownRoles();
    const recipientRoles =
      roles.filter((role) => {
        return knownRoles[role.name];
      }) || [];
    if (recipientRoles.length === 0) {
      throw ErrorFactory.GenericErrors.ValidationFailed('No valid role is present', roles);
    }
    return await this.sendMessageInternal({ message, recipientRoles: roles, type });
  }

  async sendDirectMessage(message: string, peer: HMSPeer, type?: string) {
    let recipientPeer = this.store.getPeerById(peer.peerId);
    if (!recipientPeer) {
      throw ErrorFactory.GenericErrors.ValidationFailed('Invalid peer - peer not present in the room', peer);
    }
    if (this.localPeer?.peerId === peer.peerId) {
      throw ErrorFactory.GenericErrors.ValidationFailed('Cannot send message to self');
    }
    return await this.sendMessageInternal({ message, recipientPeer: peer, type });
  }

  private async sendMessageInternal({ recipientRoles, recipientPeer, type = 'chat', message }: HMSMessageInput) {
    if (message.replace(/\u200b/g, ' ').trim() === '') {
      HMSLogger.w(this.TAG, 'sendMessage', 'Ignoring empty message send');
      throw ErrorFactory.GenericErrors.ValidationFailed('Empty message not allowed');
    }
    const hmsMessage = new Message({
      sender: this.localPeer!,
      type,
      message,
      recipientPeer,
      recipientRoles,
      time: new Date(),
    });
    HMSLogger.d(this.TAG, 'Sending Message:: ', hmsMessage);
    await this.transport.sendMessage(hmsMessage);
    return hmsMessage;
  }

  async startScreenShare(onStop: () => void, audioOnly = false) {
    const publishParams = this.publishParams;
    if (!publishParams) return;

    const { screen, allowed } = publishParams;
    const canPublishScreen = allowed && allowed.includes('screen');

    if (!canPublishScreen) {
      HMSLogger.e(this.TAG, `Role ${this.localPeer?.role} cannot share screen`);
      return;
    }

    if (this.localPeer?.auxiliaryTracks?.find((track) => track.source === 'screen')) {
      throw Error('Cannot share multiple screens');
    }

    const dimensions = this.store.getSimulcastDimensions('screen');
    const [videoTrack, audioTrack] = await this.transport!.getLocalScreen(
      new HMSVideoTrackSettingsBuilder()
        // Don't cap maxBitrate for screenshare.
        // If publish params doesn't have bitRate value - don't set maxBitrate.
        .maxBitrate(screen.bitRate, false)
        .codec(screen.codec as HMSVideoCodec)
        .maxFramerate(screen.frameRate)
        .setWidth(dimensions?.width || screen.width)
        .setHeight(dimensions?.height || screen.height)
        .build(),
      new HMSAudioTrackSettingsBuilder().build(),
    );

    const handleEnded = () => {
      this.stopEndedScreenshare(onStop);
    };

    const tracks = [];
    if (audioOnly) {
      videoTrack.nativeTrack.stop();
      if (!audioTrack) {
        throw Error('Select share audio when sharing screen');
      }
      tracks.push(audioTrack);
      audioTrack.nativeTrack.onended = handleEnded;
    } else {
      tracks.push(videoTrack);
      videoTrack.nativeTrack.onended = handleEnded;
      // audio track is not always available
      if (audioTrack) {
        tracks.push(audioTrack);
      }
    }
    await this.transport.publish(tracks);
    tracks.forEach((track) => {
      track.peerId = this.localPeer?.peerId;
      this.localPeer?.auxiliaryTracks.push(track);
      this.listener?.onTrackUpdate(HMSTrackUpdate.TRACK_ADDED, track, this.localPeer!);
    });
  }

  private async stopEndedScreenshare(onStop: () => void) {
    HMSLogger.d(this.TAG, `✅ Screenshare ended natively`);
    await this.stopScreenShare();
    onStop();
  }

  async stopScreenShare() {
    HMSLogger.d(this.TAG, `✅ Screenshare ended from app`);
    const screenTracks = this.localPeer?.auxiliaryTracks.filter((t) => t.source === 'screen');
    if (screenTracks) {
      for (let track of screenTracks) {
        await this.removeTrack(track.trackId);
      }
    }
  }

  async addTrack(track: MediaStreamTrack, source: HMSTrackSource = 'regular'): Promise<void> {
    if (!track) {
      HMSLogger.w(this.TAG, 'Please pass a valid MediaStreamTrack');
      return;
    }
    if (!this.localPeer) {
      throw ErrorFactory.GenericErrors.NotConnected(HMSAction.VALIDATION, 'No local peer present, cannot addTrack');
    }
    const isTrackPresent = this.localPeer.auxiliaryTracks.find((t) => t.trackId === track.id);
    if (isTrackPresent) {
      return;
    }

    const type = track.kind;
    const nativeStream = new MediaStream([track]);
    const stream = new HMSLocalStream(nativeStream);

    const TrackKlass = type === 'audio' ? HMSLocalAudioTrack : HMSLocalVideoTrack;
    const hmsTrack = new TrackKlass(stream, track, source);
    if (source === 'videoplaylist') {
      const settings: { maxBitrate?: number; width?: number; height?: number } = {};
      if (type === 'audio') {
        settings.maxBitrate = 64;
      } else {
        settings.maxBitrate = 1000;
        const { width, height } = track.getSettings();
        settings.width = width;
        settings.height = height;
      }
      // TODO: rt update from policy once policy is updated
      await hmsTrack.setSettings(settings);
    } else if (source === 'audioplaylist') {
      // TODO: rt update from policy once policy is updated
      await hmsTrack.setSettings({ maxBitrate: 64 });
    }

    await this.transport?.publish([hmsTrack]);
    hmsTrack.peerId = this.localPeer?.peerId;
    this.localPeer?.auxiliaryTracks.push(hmsTrack);
    this.listener?.onTrackUpdate(HMSTrackUpdate.TRACK_ADDED, hmsTrack, this.localPeer!);
  }

  async removeTrack(trackId: string) {
    if (!this.localPeer) {
      throw ErrorFactory.GenericErrors.NotConnected(HMSAction.VALIDATION, 'No local peer present, cannot removeTrack');
    }
    const trackIndex = this.localPeer.auxiliaryTracks.findIndex((t) => t.trackId === trackId);
    if (trackIndex > -1) {
      const track = this.localPeer.auxiliaryTracks[trackIndex];
      await this.transport!.unpublish([track]);
      this.localPeer.auxiliaryTracks.splice(trackIndex, 1);
      this.listener?.onTrackUpdate(HMSTrackUpdate.TRACK_REMOVED, track, this.localPeer);
    } else {
      HMSLogger.w(this.TAG, `No track found for ${trackId}`);
    }
  }

  setAnalyticsLevel(level: HMSAnalyticsLevel) {
    analyticsEventsService.level = level;
  }

  setLogLevel(level: HMSLogLevel) {
    HMSLogger.level = level;
  }

  addAudioListener(audioListener: HMSAudioListener) {
    this.audioListener = audioListener;
    this.notificationManager.setAudioListener(audioListener);
  }

  async changeRole(forPeer: HMSPeer, toRole: string, force: boolean = false) {
    if (!forPeer.role || forPeer.role.name === toRole) {
      return;
    }

    await this.transport?.changeRole(forPeer, toRole, force);
  }

  async acceptChangeRole(request: HMSRoleChangeRequest) {
    await this.transport?.acceptRoleChange(request);
  }

  async endRoom(lock: boolean, reason: string) {
    if (!this.localPeer) {
      throw ErrorFactory.GenericErrors.NotConnected(HMSAction.VALIDATION, 'No local peer present, cannot end room');
    }
    await this.transport?.endRoom(lock, reason);
  }

  async removePeer(peer: HMSRemotePeer, reason: string) {
    if (!this.localPeer) {
      throw ErrorFactory.GenericErrors.NotConnected(HMSAction.VALIDATION, 'No local peer present, cannot remove peer');
    }

    if (!this.store.getPeerById(peer.peerId)) {
      throw ErrorFactory.GenericErrors.ValidationFailed('Invalid peer, given peer not present in room', peer);
    }
    await this.transport?.removePeer(peer.peerId, reason);
  }

  async startRTMPOrRecording(params: RTMPRecordingConfig) {
    if (!this.localPeer) {
      throw ErrorFactory.GenericErrors.NotConnected(
        HMSAction.VALIDATION,
        'No local peer present, cannot start streaming or recording',
      );
    }
    await this.transport?.startRTMPOrRecording(params);
    // emit this notification to update current peer recording status
    const rtmpStart = { method: HMSNotificationMethod.RTMP_START, params: {} };
    const recordingStart = { method: HMSNotificationMethod.RECORDING_START, params: { type: 'Browser' } };
    if (params.rtmpURLs?.length) {
      this.notificationManager.handleNotification(rtmpStart);
    }
    if (params.record) {
      this.notificationManager.handleNotification(recordingStart);
    }
  }

  async stopRTMPAndRecording() {
    if (!this.localPeer) {
      throw ErrorFactory.GenericErrors.NotConnected(
        HMSAction.VALIDATION,
        'No local peer present, cannot stop streaming or recording',
      );
    }
    await this.transport?.stopRTMPOrRecording();
    // emit this notification to update current peer recording status
    const { recording, rtmp } = this.store.getRoom();
    if (recording?.browser.running) {
      this.notificationManager.handleNotification({
        method: HMSNotificationMethod.RECORDING_STOP,
        params: { type: 'Browser' },
      });
    }
    if (rtmp?.running) {
      this.notificationManager.handleNotification({ method: HMSNotificationMethod.RTMP_STOP, params: {} });
    }
  }

  getRoles(): HMSRole[] {
    return Object.values(this.store.getKnownRoles());
  }

  async changeTrackState(forRemoteTrack: HMSRemoteTrack, enabled: boolean) {
    if (forRemoteTrack.type === HMSTrackType.VIDEO && forRemoteTrack.source !== 'regular') {
      HMSLogger.w(this.TAG, `Muting non-regular video tracks is currently not supported`);
      return;
    }

    if (forRemoteTrack.enabled === enabled) {
      HMSLogger.w(this.TAG, `Aborting change track state, track already has enabled - ${enabled}`, forRemoteTrack);
      return;
    }

    if (!this.store.getTrackById(forRemoteTrack.trackId)) {
      throw ErrorFactory.GenericErrors.ValidationFailed('No track found for change track state', forRemoteTrack);
    }

    const peer = this.store.getPeerByTrackId(forRemoteTrack.trackId);

    if (!peer) {
      throw ErrorFactory.GenericErrors.ValidationFailed('No peer found for change track state', forRemoteTrack);
    }

    await this.transport?.changeTrackState({
      requested_for: peer.peerId,
      track_id: forRemoteTrack.trackId,
      stream_id: forRemoteTrack.stream.id,
      mute: !enabled,
    });
  }

  async changeMultiTrackState(params: HMSChangeMultiTrackStateParams) {
    if (typeof params.enabled !== 'boolean') {
      throw ErrorFactory.GenericErrors.ValidationFailed('Pass a boolean for enabled');
    }
    const { enabled, roles, type, source } = params;
    await this.transport?.changeMultiTrackState({
      value: !enabled,
      type,
      source,
      roles: roles?.map((role) => role?.name),
    });
  }

  private async publish(initialSettings: InitialSettings) {
    const tracks = await this.localTrackManager.getTracksToPublish(initialSettings);
    await this.setAndPublishTracks(tracks);
    this.sdkState.published = true;
  }

  private async setAndPublishTracks(tracks: HMSLocalTrack[]) {
    for (const track of tracks) {
      await this.transport.publish([track]);
      this.setLocalPeerTrack(track);
      this.listener?.onTrackUpdate(HMSTrackUpdate.TRACK_ADDED, track, this.localPeer!);
    }
    await this.initDeviceManagers();
  }

  private setLocalPeerTrack(track: HMSLocalTrack) {
    track.peerId = this.localPeer?.peerId;
    switch (track.type) {
      case HMSTrackType.AUDIO:
        this.localPeer!.audioTrack = track as HMSLocalAudioTrack;
        break;

      case HMSTrackType.VIDEO:
        this.localPeer!.videoTrack = track as HMSLocalVideoTrack;
        break;
    }
  }

  private async initDeviceManagers() {
    // No need to initialise and add listeners if already initialised in preview
    if (this.sdkState.deviceManagersInitialised) {
      return;
    }
    this.sdkState.deviceManagersInitialised = true;
    this.deviceManager.addEventListener('audio-device-change', this.handleDeviceChangeError);
    this.deviceManager.addEventListener('video-device-change', this.handleDeviceChangeError);
    await this.deviceManager.init();
    this.deviceManager.updateOutputDevice(DeviceStorageManager.getSelection()?.audioOutput?.deviceId);
    this.audioSinkManager.init(this.store.getConfig()?.audioSinkElementId);
  }

  private cleanDeviceManagers() {
    this.deviceManager.removeEventListener('audio-device-change', this.handleDeviceChangeError);
    this.deviceManager.removeEventListener('video-device-change', this.handleDeviceChangeError);
    this.deviceManager.cleanUp();
    this.audioSinkManager.removeEventListener(AutoplayError, this.handleAutoplayError);
    this.audioSinkManager.cleanUp();
  }

  private initPreviewTrackAudioLevelMonitor() {
    this.localPeer?.audioTrack?.initAudioLevelMonitor();
    this.localPeer?.audioTrack?.audioLevelMonitor?.on('AUDIO_LEVEL_UPDATE', (audioLevelUpdate) => {
      const hmsSpeakers = audioLevelUpdate
        ? [{ audioLevel: audioLevelUpdate.audioLevel, peer: this.localPeer!, track: this.localPeer?.audioTrack! }]
        : [];
      this.store.updateSpeakers(hmsSpeakers);
      this.audioListener?.onAudioLevelUpdate(hmsSpeakers);
    });
  }

  private get publishParams() {
    return this.store?.getPublishParams();
  }

  private notifyJoin() {
    const localPeer = this.store.getLocalPeer();

    if (localPeer?.role) {
      this.listener?.onJoin(this.store.getRoom());
    } else {
      this.notificationManager.once('policy-change', () => {
        this.listener?.onJoin(this.store.getRoom());
      });
    }
  }
}
