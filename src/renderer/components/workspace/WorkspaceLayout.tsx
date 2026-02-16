import { WorkspaceGridRenderer } from './WorkspaceGridRenderer'
import { WorkspaceMenuBar } from './WorkspaceMenuBar'
import { useWorkspaceLayoutController } from './useWorkspaceLayoutController'

export function WorkspaceLayout() {
  const controller = useWorkspaceLayoutController()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0E0E0D', paddingRight: 8 }}>
      <WorkspaceMenuBar
        visiblePanels={controller.visiblePanels}
        onTogglePanel={controller.handleTogglePanel}
        onOpenFolder={controller.openFolderFromDialog}
        onFocusFileSearch={controller.focusFileSearch}
        onFocusFileExplorer={controller.focusFileExplorer}
        onNewTerminal={controller.triggerNewTerminal}
        onCloseActivePanel={controller.closeActivePanel}
        onFocusChatInput={controller.focusChatInput}
        onResetLayout={controller.resetLayout}
      />

      <WorkspaceGridRenderer
        layout={controller.layout}
        containerRef={controller.containerRef}
        dropZone={controller.dropZone}
        getActiveTab={controller.getActiveTab}
        onSetActiveTab={controller.setActiveTab}
        onHidePanel={controller.handleHidePanel}
        onHideSlot={controller.handleHideSlot}
        onDragStart={controller.handleDragStart}
        onDragOver={controller.handleDragOver}
        onDrop={controller.handleDrop}
        onColumnResize={controller.handleColumnResize}
        onRowResize={controller.handleRowResize}
        onSlotResize={controller.handleSlotResize}
      />
    </div>
  )
}
