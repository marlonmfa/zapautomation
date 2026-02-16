jest.mock('../batch-sender', () => {
  const actual = jest.requireActual('../batch-sender');
  return { ...actual, sendOnce: jest.fn() };
});
jest.mock('../services/tts-voice', () => ({ textToSpeech: jest.fn() }));

const batchSender = require('../batch-sender');
const { sendTextAsVoice } = require('../services/send-voice');
const { textToSpeech } = require('../services/tts-voice');

describe('send-voice', () => {
  beforeEach(() => {
    batchSender.sendOnce.mockReset();
    textToSpeech.mockReset();
  });

  it('calls textToSpeech then sendOnce with MessageMedia and returns its result', async () => {
    textToSpeech.mockResolvedValue({
      audioBuffer: Buffer.from([0xff, 0xfb]),
      mimetype: 'audio/mpeg',
    });
    batchSender.sendOnce.mockResolvedValue({ success: true });

    const client = {};
    const result = await sendTextAsVoice(client, '5511999999999', 'Olá', { voiceId: 'v1' });

    expect(textToSpeech).toHaveBeenCalledWith('Olá', { voiceId: 'v1' });
    expect(batchSender.sendOnce).toHaveBeenCalledWith(client, '5511999999999', expect.any(Object), expect.any(Number));
    const media = batchSender.sendOnce.mock.calls[0][2];
    expect(media.mimetype).toBe('audio/mpeg');
    expect(media.data).toBe(Buffer.from([0xff, 0xfb]).toString('base64'));
    expect(result).toEqual({ success: true });
  });

  it('forwards voiceSamples and other TTS options to textToSpeech', async () => {
    textToSpeech.mockResolvedValue({
      audioBuffer: Buffer.from([]),
      mimetype: 'audio/mpeg',
    });
    batchSender.sendOnce.mockResolvedValue({ success: true });

    await sendTextAsVoice(
      {},
      '5521988888888@c.us',
      'Hello',
      {
        voiceSamples: ['/path/s1.mp3', '/path/s2.wav'],
        voiceName: 'my-voice',
        similarityBoost: 0.8,
        sendTimeoutMs: 10000,
      }
    );

    expect(textToSpeech).toHaveBeenCalledWith('Hello', {
      voiceSamples: ['/path/s1.mp3', '/path/s2.wav'],
      voiceName: 'my-voice',
      similarityBoost: 0.8,
    });
    expect(batchSender.sendOnce).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), 10000);
  });

  it('returns sendOnce error when send fails', async () => {
    textToSpeech.mockResolvedValue({
      audioBuffer: Buffer.from([]),
      mimetype: 'audio/mpeg',
    });
    batchSender.sendOnce.mockResolvedValue({ success: false, error: 'Send timeout' });

    const result = await sendTextAsVoice({}, '5511999999999', 'Hi', { voiceId: 'v1' });
    expect(result).toEqual({ success: false, error: 'Send timeout' });
  });
});
