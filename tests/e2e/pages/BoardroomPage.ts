import { Page, Locator } from '@playwright/test';

export class BoardroomPage {
  readonly page: Page;
  readonly screen: Locator;

  constructor(page: Page) {
    this.page = page;
    this.screen = page.getByTestId('boardroom-screen');
  }

  async isVisible() {
    return this.screen.isVisible();
  }
}
