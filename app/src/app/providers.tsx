'use client'

import { createContext, useContext } from 'react'
import { ThemeProvider } from 'next-themes'

// Whether this is a hosted pod. The value is read on the server (see
// lib/system/kiosk.ts) and handed down here, because the components that need
// it are client components and process.env does not reach them.
const KioskContext = createContext(false)

/** True on a hosted pod: hide anything that acts on the server's own desktop. */
export const useKiosk = () => useContext(KioskContext)

export function Providers({
  children,
  kiosk = false,
}: {
  children: React.ReactNode
  // Defaulted so every existing render — tests included — is a desktop one.
  kiosk?: boolean
}) {
  return (
    <KioskContext.Provider value={kiosk}>
      <ThemeProvider
        attribute="class"
        defaultTheme="dark"
        forcedTheme="dark"
        enableSystem={false}
        disableTransitionOnChange
      >
        {children}
      </ThemeProvider>
    </KioskContext.Provider>
  )
}
