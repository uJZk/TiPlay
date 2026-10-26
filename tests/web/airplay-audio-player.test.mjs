// SPDX-License-Identifier: GPL-3.0-only
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAirPlayAudioMedia } from '../../site/play/airplay-audio-player.js';

test('receiver snapshots confirm play and pause without an independent playback state or clock', async () => {
  const commands = [], events = [];
  const media = createAirPlayAudioMedia({ onPlay: () => commands.push('play'), onPause: () => commands.push('pause') });
  for (const type of ['play', 'pause', 'timeupdate']) media.addEventListener(type, () => events.push(type));
  media.update({ duration: 180, position: 36, playing: true, canPause: true });
  media.pause(); assert.deepEqual(commands, ['pause']);
  assert.equal(media.paused, false, 'a command is not an acknowledgement from the receiver');
  assert.equal(media.currentTime, 36);
  media.update({ duration: 180, position: 36.5, playing: false, canPause: true });
  assert.equal(media.paused, true);
  await media.play(); assert.deepEqual(commands, ['pause', 'play']); assert.equal(media.paused, true);
  media.update({ duration: 180, position: 36.5, playing: true, canPause: true });
  assert.equal(media.paused, false);
  assert.deepEqual(events, ['timeupdate', 'play', 'timeupdate', 'pause', 'play']);
  media.dispose();
});

test('unsupported seeking is inert and supported seeking waits for confirmed source position', async () => {
  const seeks = [], media = createAirPlayAudioMedia({ onSeek: target => seeks.push(target) });
  media.update({ duration: 120, position: 15, playing: true, seekable: false });
  media.currentTime = 100; assert.deepEqual(seeks, []); assert.equal(media.currentTime, 15);
  assert.equal(media.seekable.length, 0);
  media.update({ duration: 120, position: 15, playing: true, seekable: true });
  media.currentTime = 1000; assert.deepEqual(seeks, [120]); assert.equal(media.currentTime, 15);
  assert.equal(media.seeking, true);
  media.update({ duration: 120, position: 120, playing: true, seekable: true });
  assert.equal(media.currentTime, 120); assert.equal(media.seeking, false);
  media.playbackRate = 4; assert.equal(media.playbackRate, 1);
  media.dispose(); media.currentTime = 60;
  assert.deepEqual(seeks, [120], 'retired seek controls cannot command a later playback owner');
});

test('disposed or unsupported controls cannot send commands or revive retired state', async () => {
  let calls = 0;
  const media = createAirPlayAudioMedia({ onPlay: () => calls++, onPause: () => calls++ });
  media.update({ playing: true, position: 4, canPause: false });
  media.pause(); await media.play(); assert.equal(calls, 0);
  media.dispose();
  media.update({ position: 50, canPause: true }); media.pause();
  await assert.rejects(media.play(), { name: 'AbortError' });
  assert.equal(calls, 0); assert.equal(media.currentTime, 4);
});

test('relative skips and track changes need sender capabilities and never predict receiver progress', async () => {
  const commands = [];
  const media = createAirPlayAudioMedia({ onPrevious: () => commands.push('previous'), onNext: () => commands.push('next'),
    onSkipBack: () => commands.push('skip-back'), onSkipForward: () => commands.push('skip-forward') });
  const actions = ['previous', 'next', 'skipBack', 'skipForward'];
  media.update({ duration: 240, position: 121, playing: true });
  for (const action of actions) await media[action]();
  assert.deepEqual(commands, [], 'absent sender support cannot be replaced by local state changes');
  media.update({ duration: 240, position: 121, playing: true, canPrevious: true, canNext: true, canSkipBack: true, canSkipForward: true });
  for (const action of actions) await media[action]();
  assert.deepEqual(commands, ['previous', 'next', 'skip-back', 'skip-forward']);
  assert.equal(media.currentTime, 121, 'the receiver computes skips using its freshest sender position');
  assert.equal(media.seekable.length, 0, 'relative skip support does not enable arbitrary seeking');
  media.currentTime = 100; assert.equal(media.currentTime, 121);
  media.update({ duration: 240, position: 131, playing: true, canPrevious: false, canNext: true, canSkipBack: false, canSkipForward: false });
  await media.previous(); await media.skipBack(); await media.skipForward();
  assert.equal(commands.length, 4, 'revoking capabilities immediately retires the corresponding commands');
  await media.next(); assert.equal(commands.at(-1), 'next'); assert.equal(media.currentTime, 131);
  media.dispose();
  for (const action of actions) await assert.rejects(media[action](), { name: 'AbortError' });
  assert.equal(commands.length, 5, 'retired source controls cannot issue more commands');
});

test('advertised capabilities without a transport callback stay disabled', async () => {
  const media = createAirPlayAudioMedia();
  media.update({ position: 1, canPrevious: true, canNext: true, canSkipBack: true, canSkipForward: true });
  for (const capability of ['canPrevious', 'canNext', 'canSkipBack', 'canSkipForward']) assert.equal(media[capability], false);
  for (const action of ['previous', 'next', 'skipBack', 'skipForward']) await media[action]();
  assert.equal(media.currentTime, 1); media.dispose();
});
