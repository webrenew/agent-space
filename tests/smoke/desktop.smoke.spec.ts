import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { test, expect, _electron as electron } from '@playwright/test'

test('desktop smoke flows: launch, reopen, folder scope, popout, terminal', async () => {
  let tempFolder: string | null = null
  let tempUserDataDir: string | null = null
  tempUserDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-observer-userdata-'))

  const electronApp = await electron.launch({
    cwd: process.cwd(),
    args: ['.'],
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
      AGENT_SPACE_USER_DATA_DIR: tempUserDataDir,
    },
  })

  try {
    let mainWindow = await electronApp.firstWindow()
    await mainWindow.waitForLoadState('domcontentloaded')

    const finishOnboardingButton = mainWindow.getByRole('button', { name: 'Finish setup' })
    if (await finishOnboardingButton.count()) {
      await finishOnboardingButton.first().click()
    }

    await expect(mainWindow.locator('.slot-tab', { hasText: 'CHAT' }).first()).toBeVisible()
    const chooseFolderButton = mainWindow.getByRole('button', { name: 'Choose folder' }).first()
    if (await chooseFolderButton.count()) {
      await expect(chooseFolderButton).toBeVisible()
    } else {
      await expect(mainWindow.getByRole('button', { name: 'pick' }).first()).toBeVisible()
    }

    // Regression check: only allowlisted external URL protocols should be opened.
    await electronApp.evaluate(({ shell }) => {
      const g = globalThis as Record<string, unknown>
      g.__smokeOriginalOpenExternal = shell.openExternal
      g.__smokeOpenExternalCalls = [] as string[]
      shell.openExternal = async (url: string) => {
        const calls = ((g.__smokeOpenExternalCalls as string[] | undefined) ?? [])
        calls.push(url)
        g.__smokeOpenExternalCalls = calls
      }
    })
    await mainWindow.evaluate(() => {
      window.open('https://example.com/smoke-open-external')
      window.open('file:///tmp/blocked-open-external')
    })
    await expect
      .poll(async () => (
        await electronApp.evaluate(() => {
          const g = globalThis as Record<string, unknown>
          return ((g.__smokeOpenExternalCalls as string[] | undefined) ?? []).length
        })
      ))
      .toBe(1)
    const openExternalCalls = await electronApp.evaluate(() => {
      const g = globalThis as Record<string, unknown>
      return ((g.__smokeOpenExternalCalls as string[] | undefined) ?? [])
    })
    expect(openExternalCalls).toEqual(['https://example.com/smoke-open-external'])
    await electronApp.evaluate(({ shell }) => {
      const g = globalThis as Record<string, unknown>
      const original = g.__smokeOriginalOpenExternal
      if (typeof original === 'function') {
        shell.openExternal = original as typeof shell.openExternal
      }
      delete g.__smokeOriginalOpenExternal
      delete g.__smokeOpenExternalCalls
    })

    // Regression check: unsolicited Claude events must be ignored when no
    // active Claude session is tracked in this chat panel.
    const unsolicitedMarker = '__smoke_unsolicited_claude_event__'
    await electronApp.evaluate(({ BrowserWindow }, marker) => {
      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
      win?.webContents.send('claude:event', {
        sessionId: 'smoke-untracked-session',
        type: 'text',
        data: { text: marker },
      })
    }, unsolicitedMarker)
    await expect(mainWindow.getByText(unsolicitedMarker)).toHaveCount(0)

    // Regression check: duplicate ipcMain.handle registration should self-recover
    // instead of crashing startup/reopen flows.
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.handle('smoke:duplicate-ipc', () => 'first')
      ipcMain.handle('smoke:duplicate-ipc', () => 'second')
      ipcMain.removeHandler('smoke:duplicate-ipc')
    })

    await electronApp.evaluate(({ ipcMain }) => {
      let calls = 0
      ipcMain.on('smoke:duplicate-ipc-on', () => {
        calls += 1
      })
      ipcMain.on('smoke:duplicate-ipc-on', () => {
        calls += 1
      })
      ipcMain.emit('smoke:duplicate-ipc-on')
      ipcMain.removeAllListeners('smoke:duplicate-ipc-on')
      if (calls !== 1) {
        throw new Error(`Expected one listener call after duplicate registration, got ${calls}`)
      }
    })

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
      const reopenFinishOnboardingButton = mainWindow.getByRole('button', { name: 'Finish setup' })
      if (await reopenFinishOnboardingButton.count()) {
        await reopenFinishOnboardingButton.first().click()
      }
      await expect(mainWindow.locator('.slot-tab', { hasText: 'CHAT' }).first()).toBeVisible()
    }

    // Regression check: folder dialog path should still work after close/reopen
    // without targeting a destroyed BrowserWindow instance, and concurrent
    // requests should collapse into a single native dialog call.
    await electronApp.evaluate(({ dialog }) => {
      const g = globalThis as Record<string, unknown>
      g.__smokeOriginalShowOpenDialog = dialog.showOpenDialog
      g.__smokeDialogCalls = 0
      g.__smokeDialogParentDestroyed = null
      dialog.showOpenDialog = async (...args: unknown[]) => {
        g.__smokeDialogCalls = (Number(g.__smokeDialogCalls) || 0) + 1
        const firstArg = args[0] as { isDestroyed?: () => boolean } | undefined
        if (firstArg && typeof firstArg.isDestroyed === 'function') {
          g.__smokeDialogParentDestroyed = firstArg.isDestroyed()
        }
        await new Promise((resolve) => setTimeout(resolve, 80))
        return { canceled: true, filePaths: [] }
      }
    })

    await mainWindow.evaluate(async () => {
      const api = (window as unknown as {
        electronAPI: { fs: { openFolderDialog: () => Promise<string | null> } }
      }).electronAPI
      await Promise.all([api.fs.openFolderDialog(), api.fs.openFolderDialog()])
    })
    const dialogProbe = await electronApp.evaluate(() => {
      const g = globalThis as Record<string, unknown>
      return {
        calls: Number(g.__smokeDialogCalls) || 0,
        parentDestroyed: g.__smokeDialogParentDestroyed === true,
      }
    })
    expect(dialogProbe.calls).toBe(1)
    expect(dialogProbe.parentDestroyed).toBe(false)
    await electronApp.evaluate(({ dialog }) => {
      const g = globalThis as Record<string, unknown>
      const original = g.__smokeOriginalShowOpenDialog
      if (typeof original === 'function') {
        dialog.showOpenDialog = original as typeof dialog.showOpenDialog
      }
      delete g.__smokeOriginalShowOpenDialog
      delete g.__smokeDialogCalls
      delete g.__smokeDialogParentDestroyed
    })

    tempFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-observer-smoke-'))
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
    if (tempUserDataDir) {
      await fs.rm(tempUserDataDir, { recursive: true, force: true }).catch(() => {})
    }
    await electronApp.close()
  }
})
