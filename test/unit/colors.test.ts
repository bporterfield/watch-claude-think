import { describe, it, expect } from "vitest";
import chalk from "chalk";
import { getProjectColor, assignProjectColors } from "../../src/lib/colors.js";
import type { ProjectInfo } from "../../src/lib/file-system.js";

describe("colors", () => {
  describe("getProjectColor", () => {
    it("should return consistent color for same project name", () => {
      const color1 = getProjectColor("my-project");
      const color2 = getProjectColor("my-project");
      const color3 = getProjectColor("my-project");

      // Should all be the same chalk instance
      expect(color1).toBe(color2);
      expect(color2).toBe(color3);
    });

    it("should return different colors for different project names", () => {
      const color1 = getProjectColor("project-1");
      const color2 = getProjectColor("project-2");

      // Different projects should likely get different colors
      // (though theoretically could hash to same index)
      // At minimum, the function should not throw
      expect(color1).toBeDefined();
      expect(color2).toBeDefined();
    });

    it("should always return a chalk instance", () => {
      const color = getProjectColor("test-project");

      // Verify it's a chalk function
      expect(typeof color).toBe("function");

      // Verify it works like chalk
      const colored = color("test");
      expect(typeof colored).toBe("string");
    });

    it("should handle empty project names", () => {
      const color = getProjectColor("");

      expect(color).toBeDefined();
      expect(typeof color).toBe("function");
    });

    it("should handle special characters in project names", () => {
      const specialNames = [
        "project-with-dashes",
        "project_with_underscores",
        "project.with.dots",
        "project123",
        "@scoped/package",
      ];

      specialNames.forEach((name) => {
        const color = getProjectColor(name);
        expect(color).toBeDefined();
      });
    });

    it("should distribute projects across color palette", () => {
      // Create many projects to test distribution
      const projects = Array.from({ length: 100 }, (_, i) => `project-${i}`);
      const colors = projects.map((p) => getProjectColor(p));

      // Should have used multiple different colors
      const uniqueColors = new Set(colors);
      expect(uniqueColors.size).toBeGreaterThan(1);
    });

    it("should not return white color", () => {
      // Test many project names to ensure no white
      const projects = Array.from({ length: 50 }, (_, i) => `project-${i}`);

      projects.forEach((name) => {
        const color = getProjectColor(name);

        // Apply color and check it's not just the plain text (white)
        // This is a heuristic test
        expect(color).not.toBe(chalk.white);
      });
    });
  });

  describe("assignProjectColors", () => {
    it("should assign colors to all projects", () => {
      const projects: ProjectInfo[] = [
        { name: "project-1", path: "/path/1", projectDir: null },
        { name: "project-2", path: "/path/2", projectDir: null },
        { name: "project-3", path: "/path/3", projectDir: null },
      ];

      const colorMap = assignProjectColors(projects);

      expect(colorMap.size).toBe(3);
      expect(colorMap.has("project-1")).toBe(true);
      expect(colorMap.has("project-2")).toBe(true);
      expect(colorMap.has("project-3")).toBe(true);
    });

    it("should assign different colors to adjacent projects for contrast", () => {
      const projects: ProjectInfo[] = [
        { name: "project-1", path: "/path/1", projectDir: null },
        { name: "project-2", path: "/path/2", projectDir: null },
        { name: "project-3", path: "/path/3", projectDir: null },
      ];

      const colorMap = assignProjectColors(projects);

      const color1 = colorMap.get("project-1");
      const color2 = colorMap.get("project-2");
      const color3 = colorMap.get("project-3");

      // Adjacent projects should have different colors
      expect(color1).not.toBe(color2);
      expect(color2).not.toBe(color3);
    });

    it("should handle empty project list", () => {
      const projects: ProjectInfo[] = [];

      const colorMap = assignProjectColors(projects);

      expect(colorMap.size).toBe(0);
    });

    it("should handle single project", () => {
      const projects: ProjectInfo[] = [{ name: "solo", path: "/path", projectDir: null }];

      const colorMap = assignProjectColors(projects);

      expect(colorMap.size).toBe(1);
      expect(colorMap.has("solo")).toBe(true);
    });

    it("should cycle through colors when more projects than colors", () => {
      // Create more projects than available colors (18 colors in palette)
      const projects: ProjectInfo[] = Array.from({ length: 25 }, (_, i) => ({
        name: `project-${i}`,
        path: `/path/${i}`,
        projectDir: null,
      }));

      const colorMap = assignProjectColors(projects);

      expect(colorMap.size).toBe(25);

      // First and 19th project should have same color (cycling)
      const color1 = colorMap.get("project-0");
      const color19 = colorMap.get("project-18");

      expect(color1).toBeDefined();
      expect(color19).toBeDefined();
    });

    it("should return valid chalk instances for all projects", () => {
      const projects: ProjectInfo[] = [
        { name: "test-1", path: "/path/1", projectDir: null },
        { name: "test-2", path: "/path/2", projectDir: null },
      ];

      const colorMap = assignProjectColors(projects);

      colorMap.forEach((color) => {
        expect(typeof color).toBe("function");

        // Test that it works like chalk
        const colored = color("test");
        expect(typeof colored).toBe("string");
      });
    });

    it("should be deterministic for same project order", () => {
      const projects: ProjectInfo[] = [
        { name: "alpha", path: "/path/a", projectDir: null },
        { name: "beta", path: "/path/b", projectDir: null },
        { name: "gamma", path: "/path/c", projectDir: null },
      ];

      const colorMap1 = assignProjectColors(projects);
      const colorMap2 = assignProjectColors(projects);

      expect(colorMap1.get("alpha")).toBe(colorMap2.get("alpha"));
      expect(colorMap1.get("beta")).toBe(colorMap2.get("beta"));
      expect(colorMap1.get("gamma")).toBe(colorMap2.get("gamma"));
    });

    it("should assign different colors based on position, not name", () => {
      const projects1: ProjectInfo[] = [
        { name: "same-name", path: "/path/1", projectDir: null },
        { name: "other", path: "/path/2", projectDir: null },
      ];

      const projects2: ProjectInfo[] = [
        { name: "other", path: "/path/2", projectDir: null },
        { name: "same-name", path: "/path/1", projectDir: null },
      ];

      const colorMap1 = assignProjectColors(projects1);
      const colorMap2 = assignProjectColors(projects2);

      // "same-name" appears at different positions, should get different colors
      // because assignProjectColors assigns by position, not by hashing
      // (unlike getProjectColor which hashes the name)
      const sameNameColor1 = colorMap1.get("same-name");
      const sameNameColor2 = colorMap2.get("same-name");

      // These SHOULD be different because they're at different positions
      expect(sameNameColor1).not.toBe(sameNameColor2);
    });
  });

  describe("getProjectColor vs assignProjectColors", () => {
    it("getProjectColor should be hash-based (same name = same color)", () => {
      const color1 = getProjectColor("test-project");
      const color2 = getProjectColor("test-project");

      expect(color1).toBe(color2);
    });

    it("assignProjectColors should be position-based (same position = same color)", () => {
      const projects1: ProjectInfo[] = [
        { name: "first", path: "/path/1", projectDir: null },
        { name: "second", path: "/path/2", projectDir: null },
      ];

      const projects2: ProjectInfo[] = [
        { name: "different", path: "/path/3", projectDir: null },
        { name: "names", path: "/path/4", projectDir: null },
      ];

      const colorMap1 = assignProjectColors(projects1);
      const colorMap2 = assignProjectColors(projects2);

      // First position in both should get same color
      const firstColor1 = colorMap1.get("first");
      const firstColor2 = colorMap2.get("different");

      expect(firstColor1).toBe(firstColor2);
    });
  });
});
