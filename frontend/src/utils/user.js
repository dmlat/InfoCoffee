// frontend/src/utils/user.js

const AUTH_DATA_KEY = 'authData';

export const saveUserDataToLocalStorage = (userData) => {
    try {
        localStorage.setItem(AUTH_DATA_KEY, JSON.stringify(userData));
    } catch (error) {
        console.error("Could not save user data to local storage", error);
    }
};

export const clearUserDataFromLocalStorage = () => {
    localStorage.removeItem(AUTH_DATA_KEY);
};

export const getUser = () => {
    try {
        const userData = localStorage.getItem(AUTH_DATA_KEY);
        return userData ? JSON.parse(userData) : null;
    } catch (error) {
        console.error("Could not retrieve user data from local storage", error);
        return null;
    }
};