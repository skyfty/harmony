import { useAuthStore } from '@/stores/authStore'

/**
 * Ensures the user is authenticated before uploading resources.
 * If no session is active, the login dialog is presented and the caller receives `false`.
 */
export async function ensureAuthenticatedForResourceUpload(): Promise<boolean> {
	const authStore = useAuthStore()
	try {
		await authStore.initialize()
	} catch (error) {
		console.warn('[uploadGuard] Failed to initialize auth store', error)
	}
	if (authStore.isAuthenticated) {
		return true
	}
	authStore.showLoginDialog()
	return false
}
