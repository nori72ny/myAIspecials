import { Page, Locator } from '@playwright/test';

export class HomePage {
  readonly page: Page;
  readonly screen: Locator;
  readonly sidebarButton: Locator;
  readonly missionInput: Locator;
  readonly executeButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.screen = page.getByTestId('home-screen');
    this.sidebarButton = page.getByTestId('sidebar-dashboard');
    this.missionInput = page.getByTestId('mission-input-field');
    this.executeButton = page.getByTestId('mission-execute-button');
  }

  async goto() {
    await this.page.goto('/');
  }

  async navigateTo() {
    await this.sidebarButton.click({ force: true });
  }

  async isVisible() {
    return this.screen.isVisible();
  }

  async runMission(prompt: string) {
    await this.missionInput.click({ force: true });
    await this.page.waitForTimeout(500); // Allow animation to settle
    await this.missionInput.fill(prompt);
    await this.page.waitForTimeout(200); // React state update
    await this.executeButton.click({ force: true });
  }
}
