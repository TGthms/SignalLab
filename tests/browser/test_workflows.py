"""Browser regressions for the main flows; run with Playwright's Python package."""
import contextlib
import http.server
import socketserver
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

class WorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = socketserver.TCPServer(('127.0.0.1', 0), QuietHandler)
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
            self.assertIn(mode.upper(), page.locator('#open-modulation-settings').inner_text())
            page.get_by_role('button', name='Encoder').click()
        page.get_by_role('button', name='Learn', exact=True).click()
        self.assertTrue(page.get_by_role('table', name='Custom data modulation at a glance').is_visible())
        self.assertEqual(page.evaluate('document.documentElement.scrollWidth <= innerWidth'), True)

    def test_high_frequency_phase_round_trip_and_device_research(self):
        page = self.page
        page.locator('.transmission-settings summary').click()
        page.locator('#modulation').select_option('dbpsk')
        page.locator('#carrier').select_option('20500')
        page.get_by_role('button', name='Test in decoder').click()
        page.locator('#result').get_by_text('Hello from the other side of the room. 🌊').wait_for(timeout=15000)
        self.assertIn('20.5 kHz', page.locator('#result').inner_text())
        self.assertIn('20.5 kHz', page.locator('#open-modulation-settings').inner_text())
        page.get_by_role('button', name='Encoder').click()
        page.locator('#open-device-research').click()
        self.assertTrue(page.locator('#device-research').get_attribute('open') is not None)
        self.assertTrue(page.get_by_text('No model has yet been verified', exact=False).is_visible())
        self.assertTrue(page.get_by_text('Apple iPhone 12', exact=True).is_visible())

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
