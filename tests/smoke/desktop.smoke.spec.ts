import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { test, expect, _electron as electron } from '@playwright/test'

test('desktop smoke flows: launch, reopen, folder scope, popout, terminal', async () => {
  let tempFolder: string | null = null
  const electronApp = await electron.launch({
    cwd: process.cwd(),
    args: ['.'],
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
  })

  try {
    let mainWindow = await electronApp.firstWindow()
    await mainWindow.waitForLoadState('domcontentloaded')

    await expect(mainWindow.locator('.slot-tab', { hasText: 'CHAT' }).first()).toBeVisible()

    if (process.platform === 'darwin') {
      await mainWindow.close()
      await expect
        .poll(async () => (await electronApp.windows()).length)
        .toBe(0)

      const reopenedWindow = electronApp.waitForEvent('window')
      await electronApp.evaluate(({ app }) => {
        app.emit('activate')
      })
      mainWindow = await reopenedWindow
      await mainWindow.waitForLoadState('domcontentloaded')
      await expect(mainWindow.locator('.slot-tab', { hasText: 'CHAT' }).first()).toBeVisible()
    }

    tempFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-space-smoke-'))
    const tempFolderName = path.basename(tempFolder)

    await electronApp.evaluate(({ BrowserWindow }, folderPath) => {
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
      win?.webContents.send('fs:openFolder', folderPath)
    }, tempFolder)

    await expect(mainWindow.getByText(tempFolderName).first()).toBeVisible()
    await expect(mainWindow.locator(`[title="${tempFolder}"]`).first()).toBeVisible()
    await expect(mainWindow.locator('[title="Directory mode: workspace"]').first()).toBeVisible()
    await expect(mainWindow.getByRole('button', { name: 'pick' }).first()).toBeVisible()

    await mainWindow.locator('[title="Pop out to separate window"]').first().click()
    await expect.poll(async () => (await electronApp.windows()).length).toBe(2)

    const popout = (await electronApp.windows()).find((w) => w !== mainWindow)
    if (popout) {
      await popout.close()
    }
    await expect.poll(async () => (await electronApp.windows()).length).toBe(1)

    await mainWindow.locator('.slot-tab', { hasText: 'TERMINAL' }).first().click()
    const terminalTabs = mainWindow.locator('button').filter({ hasText: /Terminal \d+/ })
    const initialTerminalCount = await terminalTabs.count()

    await mainWindow.getByTitle('New Terminal').click()
    await expect
      .poll(async () => await terminalTabs.count())
      .toBeGreaterThan(initialTerminalCount)
    const countAfterCreate = await terminalTabs.count()

    const createdTerminalTab = terminalTabs.nth(countAfterCreate - 1)
    await createdTerminalTab.locator('span').filter({ hasText: /^[x×]$/ }).click()
    await expect
      .poll(async () => await terminalTabs.count())
      .toBeLessThan(countAfterCreate)
  } finally {
    if (tempFolder) {
      await fs.rm(tempFolder, { recursive: true, force: true }).catch(() => {})
    }
    await electronApp.close()
  }
})
