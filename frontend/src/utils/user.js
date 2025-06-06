// frontend/src/utils/user.js

/**
 * Сохраняет данные пользователя и его уровень доступа в localStorage.
 * @param {object} userData - Объект пользователя с бэкенда.
 */
export function saveUserDataToLocalStorage(userData) {
    if (!userData) return;
    localStorage.setItem('userId', String(userData.userId || ''));
    localStorage.setItem('telegramId', String(userData.telegramId || ''));
    localStorage.setItem('userFirstName', userData.firstName || '');
    localStorage.setItem('userUsername', userData.username || '');
    localStorage.setItem('user_setup_date', userData.setup_date || '');
    localStorage.setItem('user_tax_system', userData.tax_system || '');
    localStorage.setItem('user_acquiring_rate', String(userData.acquiring || '0'));
    localStorage.setItem('userAccessLevel', userData.accessLevel || 'none');
}

/**
 * Очищает все данные пользователя из localStorage.
 */
export function clearUserDataFromLocalStorage() {
    console.log(`Clearing all user-related data from localStorage.`);
    // Список ключей для удаления
    const keysToRemove = [
        'app_token', 'userId', 'telegramId', 'userFirstName', 'userUsername',
        'user_setup_date', 'user_tax_system', 'user_acquiring_rate',
        'userAccessLevel', 'telegram_id_unsafe', 'firstName_unsafe', 'username_unsafe'
    ];
    
    // Удаляем основные ключи
    keysToRemove.forEach(key => localStorage.removeItem(key));

    // Удаляем ключи, связанные с состоянием страниц
    Object.keys(localStorage).forEach(key => {
        if (key.startsWith('financesPage_') || key.startsWith('profilePage_')) {
            localStorage.removeItem(key);
        }
    });
}