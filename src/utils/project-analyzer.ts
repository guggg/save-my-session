/**
 * 專案分析工具
 */

import fs from 'fs/promises';
import path from 'path';
import { Architecture } from '../types.js';

export class ProjectAnalyzer {
  private projectPath: string;

  constructor(projectPath: string = process.cwd()) {
    this.projectPath = projectPath;
  }

  async analyzeArchitecture(): Promise<Architecture> {
    const [techStack, keyFiles] = await Promise.all([
      this.detectTechStack(),
      this.findKeyFiles()
    ]);

    const summary = this.generateSummary(techStack);

    return {
      summary,
      key_files: keyFiles,
      tech_stack: techStack,
      dependencies: await this.getDependencies()
    };
  }

  private async detectTechStack(): Promise<string[]> {
    const stack: string[] = [];
    const files = await this.listFiles(this.projectPath, 1); // Only top level

    // Check for common files
    const detectionRules: Record<string, string[]> = {
      'package.json': ['Node.js'],
      'tsconfig.json': ['TypeScript'],
      'requirements.txt': ['Python'],
      'Pipfile': ['Python', 'pipenv'],
      'pyproject.toml': ['Python', 'Poetry'],
      'Cargo.toml': ['Rust'],
      'go.mod': ['Go'],
      'pom.xml': ['Java', 'Maven'],
      'build.gradle': ['Java', 'Gradle'],
      'Gemfile': ['Ruby'],
      'composer.json': ['PHP'],
      'docker-compose.yml': ['Docker'],
      'Dockerfile': ['Docker']
    };

    for (const file of files) {
      const basename = path.basename(file);
      if (detectionRules[basename]) {
        stack.push(...detectionRules[basename]);
      }
    }

    // Check package.json for frameworks
    if (files.includes('package.json')) {
      const frameworks = await this.detectJSFrameworks();
      stack.push(...frameworks);
    }

    return [...new Set(stack)]; // Remove duplicates
  }

  private async detectJSFrameworks(): Promise<string[]> {
    const frameworks: string[] = [];

    try {
      const packageJsonPath = path.join(this.projectPath, 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content);

      const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies
      };

      const frameworkDetection: Record<string, string> = {
        'react': 'React',
        'vue': 'Vue',
        'angular': 'Angular',
        'svelte': 'Svelte',
        'next': 'Next.js',
        'nuxt': 'Nuxt',
        'express': 'Express',
        'fastify': 'Fastify',
        'nestjs': 'NestJS',
        'vite': 'Vite',
        'webpack': 'Webpack'
      };

      for (const [dep, framework] of Object.entries(frameworkDetection)) {
        if (allDeps && Object.keys(allDeps).some(key => key.includes(dep))) {
          frameworks.push(framework);
        }
      }
    } catch (error) {
      // Ignore if package.json doesn't exist or can't be parsed
    }

    return frameworks;
  }

  private async findKeyFiles(): Promise<string[]> {
    const keyFiles: string[] = [];

    // Common important files
    const importantPatterns = [
      'src/main.*',
      'src/index.*',
      'src/app.*',
      'main.*',
      'index.*',
      'app.*',
      'server.*',
      'README.md',
      'CLAUDE.md'
    ];

    try {
      const files = await this.listFiles(this.projectPath, 3); // 3 levels deep

      for (const pattern of importantPatterns) {
        const regex = new RegExp(pattern.replace('*', '.*'));
        const matches = files.filter(file => regex.test(file));
        keyFiles.push(...matches);
      }

      // Limit to 10 most important files
      return keyFiles.slice(0, 10);
    } catch (error) {
      return [];
    }
  }

  private async listFiles(dir: string, maxDepth: number, currentDepth: number = 0): Promise<string[]> {
    if (currentDepth >= maxDepth) {
      return [];
    }

    const files: string[] = [];

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        // Skip node_modules, .git, etc.
        if (this.shouldSkip(entry.name)) {
          continue;
        }

        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(this.projectPath, fullPath);

        if (entry.isDirectory()) {
          const subFiles = await this.listFiles(fullPath, maxDepth, currentDepth + 1);
          files.push(...subFiles);
        } else {
          files.push(relativePath);
        }
      }
    } catch (error) {
      // Ignore errors (permission denied, etc.)
    }

    return files;
  }

  private shouldSkip(name: string): boolean {
    const skipList = [
      'node_modules',
      '.git',
      '.next',
      'dist',
      'build',
      '.cache',
      'coverage',
      '.vscode',
      '.idea',
      '__pycache__',
      'venv',
      '.env'
    ];

    return skipList.includes(name) || name.startsWith('.');
  }

  private generateSummary(techStack: string[]): string {
    if (techStack.length === 0) {
      return 'Unknown project type';
    }

    // Simple summary generation
    const hasBackend = techStack.some(t =>
      ['Express', 'Fastify', 'NestJS', 'Python', 'Go', 'Rust'].includes(t)
    );
    const hasFrontend = techStack.some(t =>
      ['React', 'Vue', 'Angular', 'Svelte', 'Next.js'].includes(t)
    );

    if (hasFrontend && hasBackend) {
      return 'Full-stack application';
    } else if (hasFrontend) {
      return 'Frontend application';
    } else if (hasBackend) {
      return 'Backend application';
    } else {
      return `${techStack[0]} project`;
    }
  }

  private async getDependencies(): Promise<Record<string, string> | undefined> {
    try {
      const packageJsonPath = path.join(this.projectPath, 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf-8');
      const pkg = JSON.parse(content);

      return pkg.dependencies;
    } catch (error) {
      return undefined;
    }
  }
}
