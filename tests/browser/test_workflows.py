"""Browser regressions for the main flows; run with Playwright's Python package."""
import contextlib
import http.server
import socketserver
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2] / 'dist'

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def log_message(self, *args):
        pass

class TestServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True
    request_queue_size = 64

class WorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = TestServer(('127.0.0.1', 0), QuietHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_address[1]}/'
        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        self.page = self.browser.new_page(viewport={'width': 390, 'height': 844})
        self.page.goto(self.url)
        self.page.wait_for_function("location.hash === '#encoder'")

    def tearDown(self):
        self.page.close()

    def test_demo_preserves_draft_and_settings(self):
        page = self.page
        page.get_by_role('textbox', name='Message').fill('Keep this draft')
        page.locator('.transmission-settings summary').click()
        page.get_by_role('button', name='2×').click()
        page.get_by_role('button', name='Run a demo').click()
        page.locator('#result').get_by_text('Signal received. Three copies, same message. 🌊').wait_for()
        page.locator('#result').get_by_text('3 of 3 copies verified', exact=True).wait_for()
        self.assertTrue(page.locator('#result').get_by_text('3 of 3 copies verified', exact=True).is_visible())
        page.get_by_role('button', name='Encoder').click()
        self.assertEqual(page.get_by_role('textbox', name='Message').input_value(), 'Keep this draft')
        self.assertEqual(page.get_by_role('button', name='2×').get_attribute('aria-pressed'), 'true')

    def test_demo_works_after_manual_receive_speed_selection(self):
        page = self.page
        page.locator('.nav[data-page=decoder]').click()
        page.locator('.receiver-settings summary').click()
        page.locator('#rx-rate-auto').uncheck()
        page.locator('#rx-speed-preset').press('End')
        page.locator('.nav[data-page=encoder]').click()
        page.get_by_role('button', name='Run a demo').click()
        page.locator('#result').get_by_text('3 of 3 copies verified', exact=True).wait_for(timeout=15000)

    def test_mobile_actions_and_result_remain_reachable(self):
        page = self.page
        self.assertEqual(page.evaluate('document.documentElement.scrollWidth <= innerWidth'), True)
        button = page.get_by_role('button', name='Transmit')
        box = button.bounding_box()
        self.assertIsNotNone(box)
        self.assertLessEqual(box['y'] + box['height'], 844)
        page.get_by_role('button', name='Test in decoder').click()
        page.locator('#result').get_by_text('Hello from the other side of the room. 🌊').wait_for()
        self.assertTrue(page.locator('#result').is_visible())

    def test_settings_and_accessible_learning_state(self):
        page = self.page
        page.locator('.nav[data-page=decoder]').click()
        page.get_by_role('button', name='Match the sender’s speed').click()
        self.assertTrue(page.locator('.receiver-settings').get_attribute('open') is not None)
        self.assertTrue(page.locator('#morse-rx-wpm').evaluate('(el) => document.activeElement === el'))
        page.get_by_role('button', name='Learn', exact=True).click()
        page.get_by_role('button', name='Morse code', exact=True).click()
        self.assertEqual(page.get_by_role('button', name='Morse code', exact=True).get_attribute('aria-pressed'), 'true')
        self.assertEqual(page.get_by_role('button', name='Sound & bits', exact=True).get_attribute('aria-pressed'), 'false')

    def test_phase_modes_round_trip_and_receiver_matches(self):
        page = self.page
        for mode in ('dbpsk', 'dqpsk'):
            if page.locator('.transmission-settings').get_attribute('open') is None:
                page.locator('.transmission-settings summary').click()
            page.locator('#modulation').select_option(mode)
            page.get_by_role('button', name='Test in decoder').click()
            page.locator('#result').get_by_text('Hello from the other side of the room. 🌊').wait_for(timeout=15000)
            self.assertIn(mode.upper(), page.locator('#result').inner_text())
            self.assertEqual(page.locator('#rx-signal').input_value(), f'{mode}:1800')
            page.get_by_role('button', name='Encoder').click()
        page.get_by_role('button', name='Learn', exact=True).click()
        self.assertTrue(page.get_by_role('table', name='Custom data modulation at a glance').is_visible())
        self.assertEqual(page.evaluate('document.documentElement.scrollWidth <= innerWidth'), True)

    def test_high_frequency_phase_round_trip_and_device_research(self):
        page = self.page
        page.locator('#signal-high').click()
        self.assertEqual(page.locator('#signal-high').get_attribute('aria-pressed'), 'true')
        self.assertIn('DBPSK · 20.5 kHz', page.locator('.transmission-settings summary').inner_text())
        page.get_by_role('button', name='Test in decoder').click()
        page.locator('#result').get_by_text('Hello from the other side of the room. 🌊').wait_for(timeout=15000)
        self.assertIn('20.5 kHz', page.locator('#result').inner_text())
        self.assertEqual(page.locator('#rx-signal').input_value(), 'dbpsk:20500')
        page.get_by_role('button', name='Encoder').click()
        page.locator('#open-device-guide').click()
        self.assertTrue(page.locator('#device-research').get_attribute('open') is not None)
        self.assertTrue(page.get_by_text('Other models and newer generations may work', exact=False).is_visible())
        self.assertTrue(page.get_by_role('link', name='Apple iPhone 16 Pro Max').is_visible())

    def test_speed_presets_and_shared_receiver_settings(self):
        page = self.page
        slider = page.locator('#speed-preset')
        slider.press('Home')
        self.assertIn('Resilient', slider.get_attribute('aria-valuetext'))
        page.locator('#signal-high').click()
        page.locator('.share-settings summary').click()
        link = page.locator('#share-link').input_value()
        self.assertNotIn('Hello', link)
        page.goto(link)
        self.assertEqual(page.locator('#rx-signal').input_value(), 'dbpsk:20500')
        self.assertTrue(page.locator('#rx-rate-auto').is_checked())
        self.assertIn('detects speed automatically', page.locator('#shared-settings-note').inner_text())
        self.assertEqual(page.locator('#listen-label').inner_text(), 'Start microphone')
        page.locator('.receiver-settings summary').click()
        self.assertTrue(page.locator('#rx-speed-preset').is_disabled())
        page.locator('#rx-rate-auto').uncheck()
        self.assertTrue(page.locator('#rx-speed-preset').is_enabled())
        self.assertIn('Manual speed is on', page.locator('#rx-signal-help').inner_text())
        self.assertFalse(page.locator('#shared-settings-note').is_visible())

    def test_interactive_comparison_updates(self):
        page = self.page
        page.get_by_role('button', name='Learn', exact=True).click()
        page.locator('#experiment-mode').select_option('dqpsk')
        page.locator('#experiment-carrier').select_option('20500')
        self.assertIn('DQPSK', page.locator('#experiment-status').inner_text())
        self.assertTrue(page.locator('#experiment-spectrum').is_visible())
        page.locator('#experiment-bits').fill('010')
        self.assertIn('eight', page.locator('#experiment-status').inner_text())

    def test_long_pcm_wav_import(self):
        page = self.page
        script = """import {open} from 'node:fs/promises';
import {createCustomStream,wavHeader,pcm16} from './dist/custom-stream.mjs';
import {PROFILES} from './dist/codec.mjs';
const s=createCustomStream(new Uint8Array(3800).fill(65),{kind:'text'},PROFILES.resilient,1,'1234567890abcdef',12000);
const f=await open(process.argv[1],'w');await f.write(wavHeader(s.length,s.sr));
while(!s.done)await f.write(pcm16(s.read(24000)));await f.close();"""
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'long.wav')
            subprocess.run(['node', '--input-type=module', '-e', script, path], cwd=str(ROOT.parent), check=True)
            page.locator('.nav[data-page=decoder]').click()
            page.locator('#audio-file').set_input_files(path)
            page.locator('#result').get_by_text('1 of 1 copies verified', exact=True).wait_for(timeout=60000)
            self.assertIn('3.7 KiB', page.locator('#result').inner_text())
            self.assertTrue(page.locator('#result-source').inner_text().startswith('Imported WAV'))

    def test_large_transfer_has_no_five_minute_cap(self):
        page = self.page
        page.get_by_role('textbox', name='Message').fill('x' * 8192)
        page.locator('.transmission-settings summary').click()
        page.get_by_label('Modem profile').select_option('resilient')
        page.wait_for_timeout(300)
        self.assertNotEqual(page.locator('#duration-estimate').inner_text(), 'Over 5 minutes')
        self.assertFalse(page.locator('#signal-limit').is_visible())

    def test_entry_starts_at_top_and_deep_links_work(self):
        page = self.page
        for fragment, heading in [('', 'Encoder'), ('#encoder', 'Encoder'), ('#decoder', 'Decoder'), ('#learn/morse', 'Signal notes')]:
            page.goto('about:blank')
            page.goto(self.url + fragment)
            page.get_by_role('heading', name=heading, level=1).wait_for()
            self.assertAlmostEqual(page.evaluate('window.scrollY'), 0, delta=1, msg=fragment or 'root')
            self.assertTrue(page.locator('.mode-nav').is_visible())
        self.assertEqual(page.get_by_role('button', name='Morse code', exact=True).get_attribute('aria-pressed'), 'true')
        page.locator('.brand').click()
        self.assertTrue(page.get_by_role('heading', name='Encoder', level=1).is_visible())
        self.assertAlmostEqual(page.evaluate('window.scrollY'), 0, delta=1)

    def test_header_stays_visible_when_scrolling(self):
        page = self.page
        page.get_by_role('button', name='Learn', exact=True).click()
        page.mouse.wheel(0, 1400)
        page.wait_for_timeout(150)
        self.assertAlmostEqual(page.locator('.appbar').evaluate('(el) => el.getBoundingClientRect().top'), 0, delta=1)
        self.assertEqual(page.locator('.appbar .repo-link').count(), 0)

    def test_custom_stream_playback_completes(self):
        page = self.page
        page.get_by_role('textbox', name='Message').fill('Hi')
        page.locator('#play').click()
        page.wait_for_function("document.querySelector('#play-label').textContent === 'Stop'")
        page.wait_for_function("document.querySelector('#play-label').textContent === 'Transmit'", timeout=15000)

    def test_live_microphone_keeps_earlier_messages_visible(self):
        script = """import {writeFile} from 'node:fs/promises';
import {packet,modulate,joinAudio,PROFILES,customPreambleBytes,wav} from './dist/codec.mjs';
const p=PROFILES.balanced, sr=48000, meta={kind:'text'}, enc=new TextEncoder();
const signals=['First message','Second message'].map((text,index)=>modulate(packet(enc.encode(text),meta,{id:index?'2222222222222222':'1111111111111111',preambleBytes:customPreambleBytes(p)}),p,sr));
const audio=joinAudio([new Float32Array(sr),...signals,new Float32Array(sr)],sr,1);
await writeFile(process.argv[1],new Uint8Array(wav(audio,sr)));"""
        with tempfile.TemporaryDirectory() as directory:
            path = str(Path(directory) / 'microphone.wav')
            subprocess.run(['node', '--input-type=module', '-e', script, path], cwd=str(ROOT.parent), check=True)
            browser = self.playwright.chromium.launch(args=[
                '--use-fake-device-for-media-stream',
                '--use-fake-ui-for-media-stream',
                '--use-file-for-fake-audio-capture=' + path + '%noloop',
            ])
            try:
                context = browser.new_context(permissions=['microphone'], viewport={'width': 390, 'height': 844})
                page = context.new_page()
                page.goto(self.url)
                page.wait_for_function("location.hash === '#encoder'")
                page.locator('.nav[data-page=decoder]').click()
                page.locator('#listen').click()
                page.locator('#result').get_by_text('First message', exact=True).wait_for(timeout=20000)
                page.locator('#result').get_by_text('Second message', exact=True).wait_for(timeout=20000)
                previous = page.locator('#earlier-receptions')
                self.assertTrue(previous.get_by_text('First message', exact=True).is_visible())
                self.assertTrue(page.locator('#result').get_by_text('Second message', exact=True).is_visible())
                self.assertEqual(page.locator('#count').inner_text(), '2')
                page.locator('#listen').click()
                self.assertTrue(previous.get_by_text('First message', exact=True).is_visible())
                previous.get_by_role('button', name='Open log').click()
                self.assertTrue(page.locator('#history-list').get_by_text('First message', exact=True).is_visible())
                self.assertTrue(page.locator('#history-list').get_by_text('Second message', exact=True).is_visible())
                context.close()
            finally:
                browser.close()

    def test_same_study_context(self):
        page = self.page
        page.get_by_role('button', name='EAS / SAME', exact=True).click()
        self.assertTrue(page.get_by_text('EAS tones are regulated').is_visible())
        self.assertTrue(page.get_by_text('In the U.S., FCC rules restrict transmitting EAS codes', exact=False).is_visible())

    def test_same_study_is_silent_and_cannot_export(self):
        page = self.page
        page.get_by_role('button', name='EAS / SAME', exact=True).click()
        self.assertFalse(page.locator('#export').is_visible())
        self.assertTrue(page.get_by_text('Prefer the silent decoder test.', exact=False).is_visible())
        self.assertEqual(page.locator('#loopback').get_attribute('class').split().count('primary'), 1)
        # The handler must refuse export even if invoked outside the visible UI.
        page.locator('#export').evaluate('(element) => element.click()')
        page.get_by_text('EAS WAV export is unavailable.', exact=False).last.wait_for()
        page.get_by_role('button', name='Test in decoder').click()
        page.locator('#result').get_by_text('3 matching SAME headers', exact=True).wait_for(timeout=15000)
        self.assertFalse(page.locator('#playback-timeline').is_visible())
        page.get_by_role('button', name='Encoder').click()
        page.get_by_role('button', name='Morse', exact=True).click()
        self.assertTrue(page.locator('#export').is_visible())
        page.get_by_role('button', name='Custom data', exact=True).click()
        self.assertTrue(page.locator('#export').is_visible())

    def test_eas_playback_confirmation_and_escape(self):
        page = self.page
        page.get_by_role('button', name='EAS / SAME', exact=True).click()
        page.evaluate("""() => {
            window.__testAudioStarts = 0;
            AudioContext.prototype.createBufferSource = function() {
                return { connect() {}, disconnect() {}, start() {
                    window.__testAudioStarts++;
                    queueMicrotask(() => this.onended && this.onended());
                }};
            };
        }""")
        page.locator('#play').click()
        dialog = page.get_by_role('alertdialog', name='Before playing EAS tones')
        dialog.wait_for()
        self.assertTrue(page.locator('#eas-play-cancel').evaluate('(el) => document.activeElement === el'))
        self.assertEqual(page.evaluate('window.__testAudioStarts'), 0)
        page.keyboard.press('Escape')
        self.assertFalse(dialog.is_visible())
        self.assertEqual(page.evaluate('window.__testAudioStarts'), 0)
        page.locator('#play').click()
        dialog.wait_for()
        page.locator('#eas-play-cancel').click()
        self.assertFalse(dialog.is_visible())
        self.assertEqual(page.evaluate('window.__testAudioStarts'), 0)
        page.locator('#play').click()
        dialog.wait_for()
        page.locator('#eas-play-confirm').click()
        page.wait_for_function('window.__testAudioStarts === 1')
        self.assertFalse(dialog.is_visible())
        self.assertEqual(page.evaluate('window.__testAudioStarts'), 1)

    def test_attention_signal_confirmation_is_silent(self):
        page = self.page
        page.get_by_role('button', name='EAS / SAME', exact=True).click()
        page.get_by_text('Announcement & attention signal').click()
        checkbox = page.locator('#attention')
        checkbox.click()
        dialog = page.get_by_role('alertdialog', name='Include the attention signal?')
        dialog.wait_for()
        self.assertFalse(checkbox.is_checked())
        self.assertTrue(page.locator('#eas-attention-cancel').evaluate('(el) => document.activeElement === el'))
        page.keyboard.press('Escape')
        self.assertFalse(dialog.is_visible())
        self.assertFalse(checkbox.is_checked())
        checkbox.click()
        dialog.wait_for()
        page.locator('#eas-attention-cancel').click()
        self.assertFalse(checkbox.is_checked())
        checkbox.click()
        dialog.wait_for()
        page.locator('#eas-attention-confirm').click()
        self.assertTrue(checkbox.is_checked())
        self.assertFalse(page.locator('#playback-timeline').is_visible())
        page.locator('#play').click()
        playback = page.get_by_role('alertdialog', name='Before playing EAS tones')
        playback.wait_for()
        self.assertTrue(page.locator('#eas-dialog-attention').is_visible())
        self.assertIn('eas-dialog-attention', playback.get_attribute('aria-describedby'))
        page.keyboard.press('Escape')
        checkbox.click()
        self.assertFalse(checkbox.is_checked())
        page.locator('#play').click()
        playback.wait_for()
        self.assertFalse(page.locator('#eas-dialog-attention').is_visible())
        self.assertNotIn('eas-dialog-attention', playback.get_attribute('aria-describedby'))
        page.keyboard.press('Escape')

if __name__ == '__main__':
    unittest.main()
