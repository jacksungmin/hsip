"""Tests for the crash-data block of the manifest (output/publish.py)."""

import unittest

from output.publish import _resolve_crash_data

FLAGS = {"hsip": ["HSIP_101", "HSIP_107"], "ea": ["EA_01_Speed"]}


class ResolveCrashDataTest(unittest.TestCase):
    def test_records_years_and_flag_layout_from_this_build(self):
        block = _resolve_crash_data([2023, 2024, 2025], FLAGS, None)
        self.assertEqual(block["years"], [2023, 2024, 2025])
        self.assertEqual(block["hsipFields"], ["HSIP_101", "HSIP_107"])
        self.assertEqual(block["eaFields"], ["EA_01_Speed"])

    def test_refuses_a_crash_build_without_its_flag_layout(self):
        with self.assertRaises(ValueError):
            _resolve_crash_data([2024], None, None)

    def test_carries_a_complete_previous_block_forward(self):
        prev = {"years": [2024], "hsipFields": ["HSIP_101"], "eaFields": ["EA_01_Speed"]}
        self.assertIs(_resolve_crash_data(None, None, prev), prev)

    def test_refuses_to_carry_forward_a_block_without_the_flag_layout(self):
        # A pre-v4 manifest: carrying it forward would publish a database the
        # app has no way to check against its own work-code list.
        with self.assertRaises(ValueError):
            _resolve_crash_data(None, None, {"years": [2024]})


if __name__ == "__main__":
    unittest.main()
