// One-question screen (spec §10.2): heading, description, per-kind input,
// accessible inline validation message, continue button, keyboard hint.
// Mounted with key={blockId} by the parent so each question gets fresh focus.
import type { Block } from '../../bridge';
import {
  isInstantAnswer,
  isQuestionKind,
  propAccept,
  propBool,
  propNum,
  propOptions,
  propStr,
  shuffled,
} from '../machine/helpers';
import { questionLabel } from '../validation/validateAnswer';
import { ChoiceList } from '../inputs/ChoiceList';
import { FileUploadInput } from '../inputs/FileUpload';
import { NpsInput } from '../inputs/NpsInput';
import { RatingInput } from '../inputs/RatingInput';
import { TextArea } from '../inputs/TextArea';
import { TextField } from '../inputs/TextField';
import type { QuestionInputCommon } from '../inputs/shared';

export interface QuestionScreenProps {
  block: Block;
  /** 1-based question number for the ARIA announcement. */
  number: number;
  total: number;
  value: unknown;
  error: string | null;
  onChange: (value: unknown) => void;
  onSubmit: () => void;
}

export function QuestionScreen({ block, number, total, value, error, onChange, onSubmit }: QuestionScreenProps) {
  const props = block.props ?? {};
  const kind = block.kind;
  const description = propStr(props, 'description') || '';
  const labelId = `ff-label-${block.id}`;
  const descId = `ff-desc-${block.id}`;
  const errorId = `ff-error-${block.id}`;
  const describedByIds =
    [description ? descId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined;

  const inputCommon: QuestionInputCommon = {
    blockId: block.id,
    value,
    error,
    onChange,
    onSubmit,
    labelId,
    describedByIds,
    autoFocus: true,
  };

  let input = null;
  if (isQuestionKind(kind)) {
    switch (kind) {
      case 'short-text':
      case 'email':
      case 'number':
        input = (
          <TextField
            {...inputCommon}
            kind={kind}
            placeholder={propStr(props, 'placeholder') || undefined}
            maxLength={propNum(props, 'maxLength')}
            min={propNum(props, 'min')}
            max={propNum(props, 'max')}
            value={value}
          />
        );
        break;
      case 'long-text':
        input = (
          <TextArea
            {...inputCommon}
            placeholder={propStr(props, 'placeholder') || undefined}
            maxLength={propNum(props, 'maxLength')}
            value={value}
          />
        );
        break;
      case 'single-select': {
        // SPEC-NOTE: randomize shuffles per mount (client-only concern).
        const options = propBool(props, 'randomize') ? shuffled(propOptions(props)) : propOptions(props);
        input = (
          <ChoiceList
            {...inputCommon}
            options={options}
            allowOther={propBool(props, 'allowOther')}
            searchable={false}
            value={value}
          />
        );
        break;
      }
      case 'dropdown':
        input = (
          <ChoiceList
            {...inputCommon}
            options={propOptions(props)}
            searchable={propBool(props, 'searchable')}
            value={value}
          />
        );
        break;
      case 'rating':
        input = (
          <RatingInput
            {...inputCommon}
            scale={propNum(props, 'scale')}
            icon={propStr(props, 'icon') || undefined}
            value={value}
          />
        );
        break;
      case 'nps':
        input = (
          <NpsInput
            {...inputCommon}
            leftLabel={propStr(props, 'leftLabel') || undefined}
            rightLabel={propStr(props, 'rightLabel') || undefined}
            value={value}
          />
        );
        break;
      case 'file-upload':
        // T16 (issue #16): direct-to-storage upload — presign → PUT → confirm
        // per file; the answer only ever holds confirmed asset ids.
        input = (
          <FileUploadInput
            {...inputCommon}
            accept={propAccept(props)}
            maxSizeMb={propNum(props, 'maxSizeMb')}
            maxFiles={propNum(props, 'maxFiles')}
            value={value}
          />
        );
        break;
      default:
        input = null; // unreachable while isQuestionKind guards the switch
    }
  }

  if (!input) {
    // Unknown/unsupported question kinds never crash the flow; the parent
    // filters them out — this is a defensive last resort.
    return (
      <section className="ff-screen" aria-labelledby={labelId}>
        <h2 id={labelId} className="ff-question-label">
          {questionLabel(block, number - 1)}
        </h2>
        <p className="ff-hint">This question type is not supported yet — it will be skipped.</p>
      </section>
    );
  }

  return (
    <section className="ff-screen" aria-labelledby={labelId}>
      <p
        className="ff-visually-hidden"
        role="status"
        aria-live="polite"
      >
        {`Question ${number} of ${total}: ${questionLabel(block, number - 1)}`}
      </p>
      <h2 id={labelId} className="ff-question-label">
        {questionLabel(block, number - 1)}
      </h2>
      {description && (
        <p id={descId} className="ff-question-desc">
          {description}
        </p>
      )}
      {input}
      {error && (
        <p id={errorId} role="alert" className="ff-error">
          {error}
        </p>
      )}
      {!isInstantAnswer(kind) && (
        <button type="button" className="ff-continue" onClick={onSubmit}>
          {propStr(props, 'buttonText') || 'OK'} <span aria-hidden="true">→</span>
        </button>
      )}
    </section>
  );
}
