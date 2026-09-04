import unittest

from shapely.geometry import MultiPolygon, Polygon

from ingest.jurisdictions import _normalize_polygonal_geometry


class NormalizeJurisdictionGeometryTests(unittest.TestCase):
    def test_dissolves_overlapping_multipart_polygons(self):
        first = Polygon([(0, 0), (2, 0), (2, 2), (0, 2), (0, 0)])
        second = Polygon([(1, 1), (3, 1), (3, 3), (1, 3), (1, 1)])
        source = MultiPolygon([first, second])

        result = _normalize_polygonal_geometry(source, "Overlapping city")

        self.assertTrue(result.is_valid)
        self.assertEqual(result.geom_type, "Polygon")
        self.assertEqual(result.area, 7)

    def test_repairs_a_self_intersecting_polygon(self):
        source = Polygon([(0, 0), (2, 2), (0, 2), (2, 0), (0, 0)])

        result = _normalize_polygonal_geometry(source, "Bowtie city")

        self.assertTrue(result.is_valid)
        self.assertIn(result.geom_type, {"Polygon", "MultiPolygon"})
        self.assertGreater(result.area, 0)

    def test_leaves_valid_geometry_unchanged(self):
        source = Polygon([(0, 0), (2, 0), (2, 2), (0, 2), (0, 0)])

        result = _normalize_polygonal_geometry(source, "Valid city")

        self.assertIs(result, source)


if __name__ == "__main__":
    unittest.main()
