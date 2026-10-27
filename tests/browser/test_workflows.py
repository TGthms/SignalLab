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

    def test_large_transfer_has_no_five_minute_cap(self):
        page = self.page
        page.get_by_role('textbox', name='Message').fill('x' * 8192)
        page.locator('.transmission-settings summary').click()
        page.get_by_label('Modem profile').select_option('resilient')
        page.wait_for_timeout(300)
        self.assertNotEqual(page.locator('#duration-estimate').inner_text(), 'Over 5 minutes')
        self.assertFalse(page.locator('#signal-limit').is_visible())

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

if __name__ == '__main__':
    unittest.main()
