import { auth } from "./firebase-config.js";

import {
    confirmPasswordReset,
    verifyPasswordResetCode
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const loadingState = document.getElementById("loadingState");
const resetState = document.getElementById("resetState");
const successState = document.getElementById("successState");
const invalidState = document.getElementById("invalidState");

const resetForm = document.getElementById("resetForm");
const passwordInput = document.getElementById("password");
const togglePassword = document.getElementById("togglePassword");
const resetButton = document.getElementById("resetButton");

const errorMessage = document.getElementById("errorMessage");
const invalidMessage = document.getElementById("invalidMessage");

const lengthRequirement = document.getElementById("lengthRequirement");
const uppercaseRequirement = document.getElementById("uppercaseRequirement");
const numberRequirement = document.getElementById("numberRequirement");
const specialRequirement = document.getElementById("specialRequirement");

const params = new URLSearchParams(window.location.search);

const mode = params.get("mode");
const oobCode = params.get("oobCode");

function showState(state) {
    loadingState.hidden = true;
    resetState.hidden = true;
    successState.hidden = true;
    invalidState.hidden = true;

    state.hidden = false;
}

function validatePassword(password) {
    const requirements = {
        length: password.length >= 8,
        uppercase: /[A-Z]/.test(password),
        number: /[0-9]/.test(password),
        special: /[$&+,:;/=?@#|'<>.^*()_%!-]/.test(password)
    };

    lengthRequirement.classList.toggle("valid", requirements.length);
    uppercaseRequirement.classList.toggle("valid", requirements.uppercase);
    numberRequirement.classList.toggle("valid", requirements.number);
    specialRequirement.classList.toggle("valid", requirements.special);

    return (
        requirements.length &&
        requirements.uppercase &&
        requirements.number &&
        requirements.special
    );
}

function showError(message) {
    errorMessage.textContent = message;
    errorMessage.hidden = false;
}

function hideError() {
    errorMessage.textContent = "";
    errorMessage.hidden = true;
}

async function initialisePasswordReset() {
    if (mode !== "resetPassword" || !oobCode) {
        invalidMessage.textContent =
            "This password reset link is invalid. Please request a new password reset link.";

        showState(invalidState);

        return;
    }

    try {
        await verifyPasswordResetCode(auth, oobCode);

        showState(resetState);
    } catch (error) {
        invalidMessage.textContent =
            "This password reset link is invalid or has expired. Please request a new password reset link.";

        showState(invalidState);
    }
}

passwordInput.addEventListener("input", () => {
    validatePassword(passwordInput.value);
    hideError();
});

togglePassword.addEventListener("click", () => {
    const isPassword = passwordInput.type === "password";

    passwordInput.type = isPassword ? "text" : "password";

    togglePassword.textContent = isPassword ? "Hide" : "Show";

    togglePassword.setAttribute(
        "aria-label",
        isPassword ? "Hide password" : "Show password"
    );
});

resetForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    hideError();

    const password = passwordInput.value;

    if (!validatePassword(password)) {
        showError(
            "Please create a password that meets all of the requirements."
        );

        return;
    }

    resetButton.disabled = true;
    resetButton.textContent = "Resetting password...";

    try {
        await confirmPasswordReset(
            auth,
            oobCode,
            password
        );

        showState(successState);
    } catch (error) {
        resetButton.disabled = false;
        resetButton.textContent = "Reset password";

        if (error.code === "auth/expired-action-code") {
            showError(
                "This password reset link has expired. Please request a new one."
            );

            return;
        }

        if (error.code === "auth/invalid-action-code") {
            showError(
                "This password reset link is no longer valid."
            );

            return;
        }

        showError(
            "Password reset failed. Please try again."
        );
    }
});

initialisePasswordReset();
