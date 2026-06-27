import unittest

from pydantic import ValidationError

from app.schemas.terminal import InstallPackagesRequest


class InstallPackagesRequestTests(unittest.TestCase):
    def test_accepts_package_names_and_versions(self):
        request = InstallPackagesRequest(
            packages=[
                "react",
                "@radix-ui/react-tabs",
                "lucide-react@0.468.0",
                "@scope/pkg@1.2.3-beta.1",
            ],
        )

        self.assertEqual(
            request.packages,
            ["react", "@radix-ui/react-tabs", "lucide-react@0.468.0", "@scope/pkg@1.2.3-beta.1"],
        )

    def test_trims_and_deduplicates_package_specs(self):
        request = InstallPackagesRequest(packages=[" react ", "react", "clsx"])

        self.assertEqual(request.packages, ["react", "clsx"])

    def test_rejects_npm_flags_paths_and_urls(self):
        invalid_specs = [
            "--ignore-scripts",
            "../local-package",
            "https://example.com/pkg.tgz",
            "pkg name",
            "",
        ]

        for spec in invalid_specs:
            with self.subTest(spec=spec):
                with self.assertRaises(ValidationError):
                    InstallPackagesRequest(packages=[spec])


if __name__ == "__main__":
    unittest.main()
